import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url) {
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const handlersRef = useRef({});

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = url || `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'connected':
          setClientId(msg.clientId);
          break;
        case 'joined':
          setPlayerId(msg.playerId);
          setError(null);
          if (msg.state) setGameState(msg.state);
          break;
        case 'phase_change':
        case 'state_update':
        case 'config_updated':
        case 'questioning_started':
        case 'round_result':
        case 'game_over':
        case 'player_joined':
          if (msg.state) setGameState(msg.state);
          break;
        case 'discussion_message':
          setMessages(prev => [...prev, {
            type: 'discussion',
            playerId: msg.playerId,
            message: msg.message,
            timestamp: Date.now(),
          }]);
          if (msg.state) setGameState(msg.state);
          break;
        case 'question_submitted':
        case 'host_answer':
          if (msg.state) setGameState(msg.state);
          // Track AI questions in messages for TTS
          if (msg.type === 'host_answer' && msg.state?.round?.questions) {
            const q = msg.state.round.questions[msg.questionIndex];
            if (q?.playerId?.startsWith('ai_')) {
              setMessages(prev => [...prev, {
                type: 'ai_question',
                playerId: q.playerId,
                message: q.question,
                timestamp: Date.now(),
              }]);
            }
            // Also track host answer for TTS
            if (q?.answer) {
              setMessages(prev => [...prev, {
                type: 'host_answer',
                playerId: 'host',
                message: `主持人回答：${q.answer}`,
                timestamp: Date.now(),
              }]);
            }
          }
          break;
        case 'guess_submitted':
          if (msg.state) setGameState(msg.state);
          break;
        case 'voting_started':
          if (msg.state) setGameState(msg.state);
          break;
        case 'error':
          console.error('Server error:', msg.message);
          setError(msg.message);
          break;
      }

      // Call custom handlers
      if (handlersRef.current[msg.type]) {
        handlersRef.current[msg.type](msg);
      }
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const on = useCallback((type, handler) => {
    handlersRef.current[type] = handler;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    connected, clientId, gameState, playerId, messages, error,
    send, on, setGameState, clearError,
  };
}
