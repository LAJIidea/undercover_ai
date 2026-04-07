import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Lobby from './components/Lobby.jsx';
import GameDisplay from './components/GameDisplay.jsx';

export default function App() {
  const ws = useWebSocket();
  const [roomId, setRoomId] = useState(() => localStorage.getItem('currentRoomId'));
  const [hostToken, setHostToken] = useState(() => {
    const rid = localStorage.getItem('currentRoomId');
    return rid ? localStorage.getItem(`hostToken_${rid}`) : null;
  });

  const handleCreateRoom = () => {
    ws.send({ type: 'create_room' });
    ws.on('room_created', (msg) => {
      setRoomId(msg.roomId);
      setHostToken(msg.hostToken);
      localStorage.setItem('currentRoomId', msg.roomId);
      if (msg.hostToken) {
        localStorage.setItem(`hostToken_${msg.roomId}`, msg.hostToken);
      }
      if (msg.state) ws.setGameState(msg.state);
    });
  };

  // Recover state after reconnect if we have roomId but no gameState
  useEffect(() => {
    if (roomId && ws.connected && !ws.gameState) {
      const token = hostToken || localStorage.getItem(`hostToken_${roomId}`);
      ws.send({ type: 'get_state', roomId, clientType: 'display', hostToken: token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, ws.connected, ws.gameState]);

  // If we get an error while trying to recover a room, clear stale state
  useEffect(() => {
    if (ws.error && roomId && !ws.gameState) {
      localStorage.removeItem('currentRoomId');
      if (roomId) localStorage.removeItem(`hostToken_${roomId}`);
      setRoomId(null);
      setHostToken(null);
      ws.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.error]);

  const phase = ws.gameState?.phase;

  // Clear persisted room state when game is over so next refresh starts fresh
  useEffect(() => {
    if (phase === 'game_over') {
      localStorage.removeItem('currentRoomId');
      if (roomId) localStorage.removeItem(`hostToken_${roomId}`);
    }
  }, [phase, roomId]);

  const handleNewGame = () => {
    setRoomId(null);
    setHostToken(null);
    ws.setGameState(null);
    ws.clearMessages();
  };

  if (!roomId) {
    return (
      <div className="min-h-screen bg-game-bg flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-5xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            谁是卧底
          </h1>
          <p className="text-gray-400 text-lg mb-8">AI vs 真人</p>
          <button
            onClick={handleCreateRoom}
            disabled={!ws.connected}
            className="px-8 py-4 bg-primary hover:bg-primary-dark rounded-xl text-xl font-semibold
              transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg shadow-primary/25 hover:shadow-primary/40"
          >
            创建游戏房间
          </button>
          {!ws.connected && (
            <p className="text-red-400 mt-4 text-sm">正在连接服务器...</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'waiting' || phase === 'configuring') {
    return <Lobby roomId={roomId} ws={ws} />;
  }

  return <GameDisplay roomId={roomId} ws={ws} onNewGame={handleNewGame} hostToken={hostToken} />;
}
