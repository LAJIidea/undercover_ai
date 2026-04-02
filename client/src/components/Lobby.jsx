import { useState, useEffect } from 'react';
import ConfigPanel from './ConfigPanel.jsx';

export default function Lobby({ roomId, ws }) {
  const state = ws.gameState;
  const joinUrl = `${window.location.origin}/play/${roomId}`;
  const humanCount = state?.humanPlayers?.length || 0;

  const handleStartGame = () => {
    ws.send({ type: 'start_game' });
  };

  return (
    <div className="min-h-screen bg-game-bg p-8">
      <div className="max-w-4xl mx-auto">
        {/* Room header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">游戏大厅</h1>
          <div className="bg-card-bg border border-card-border rounded-xl p-4 inline-block">
            <p className="text-gray-400 text-sm mb-1">房间号</p>
            <p className="text-4xl font-mono font-bold text-accent tracking-wider">{roomId}</p>
            <p className="text-gray-500 text-xs mt-2 break-all">{joinUrl}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Players */}
          <div className="bg-card-bg border border-card-border rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">
              真人玩家 ({humanCount}/4)
            </h2>
            <div className="space-y-3">
              {state?.humanPlayers?.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 bg-game-bg rounded-lg p-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold">
                    {p.name?.[0] || (i + 1)}
                  </div>
                  <span>{p.name}</span>
                  <span className={`ml-auto text-sm ${p.connected ? 'text-green-400' : 'text-red-400'}`}>
                    {p.connected ? '在线' : '离线'}
                  </span>
                </div>
              ))}
              {Array.from({ length: 4 - humanCount }).map((_, i) => (
                <div key={`empty-${i}`} className="flex items-center gap-3 bg-game-bg rounded-lg p-3 opacity-40">
                  <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center">?</div>
                  <span className="text-gray-500">等待加入...</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Config */}
          <ConfigPanel ws={ws} />
        </div>

        {/* Start button */}
        <div className="text-center mt-8">
          <button
            onClick={handleStartGame}
            disabled={humanCount < 4}
            className="px-12 py-4 bg-accent hover:bg-amber-600 rounded-xl text-xl font-bold
              text-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg shadow-accent/25"
          >
            {humanCount < 4 ? `等待玩家加入 (${humanCount}/4)` : '开始游戏'}
          </button>
        </div>
      </div>
    </div>
  );
}
