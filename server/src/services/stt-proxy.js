import WebSocket, { WebSocketServer } from 'ws';
import { getRoom } from '../game/engine.js';

// Server-side WebSocket proxy for FunASR STT
// Clients connect to /ws-stt, server relays to FunASR with credentials
export function setupSTTProxy(server) {
  const url = process.env.FUNASR_API_URL;
  const key = process.env.FUNASR_API_KEY;

  if (!url || !key) {
    console.log('FunASR not configured, STT proxy disabled');
    return;
  }

  const wss = new WebSocketServer({ server, path: '/ws-stt' });

  wss.on('connection', (clientWs) => {
    let authenticated = false;
    let funasrWs = null;
    let messageBuffer = [];
    const MAX_BUFFER_SIZE = 100;

    // Auth timeout: close if not authenticated within 5 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) clientWs.close(1008, 'Auth timeout');
    }, 5000);

    clientWs.on('message', (data) => {
      // First message must be JSON auth payload
      if (!authenticated) {
        clearTimeout(authTimeout);
        try {
          const auth = JSON.parse(data.toString());
          if (!auth.token || !auth.roomId) {
            clientWs.close(1008, 'Missing authentication');
            return;
          }
          const room = getRoom(auth.roomId);
          if (!room) {
            clientWs.close(1008, 'Invalid room');
            return;
          }
          const validPlayer = room.state.humanPlayers.find(
            p => p.reconnectToken === auth.token && p.connected
          );
          if (!validPlayer) {
            clientWs.close(1008, 'Invalid token');
            return;
          }
          authenticated = true;

          // Establish upstream FunASR connection
          const separator = url.includes('?') ? '&' : '?';
          const authenticatedUrl = `${url}${separator}token=${encodeURIComponent(key)}`;
          funasrWs = new WebSocket(authenticatedUrl);
          funasrWs.binaryType = 'arraybuffer';

          funasrWs.on('open', () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'ready' }));
            }
            for (const buffered of messageBuffer) {
              funasrWs.send(buffered);
            }
            messageBuffer = [];
          });

          funasrWs.on('message', (fData) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(fData);
            }
          });

          funasrWs.on('error', (err) => {
            console.error('FunASR connection error:', err);
            clientWs.close();
          });

          funasrWs.on('close', () => clientWs.close());
          clientWs.on('error', () => funasrWs?.close());
        } catch {
          clientWs.close(1008, 'Invalid auth message');
        }
        return;
      }

      // Authenticated: relay audio to FunASR
      if (funasrWs?.readyState === WebSocket.OPEN) {
        funasrWs.send(data);
      } else {
        if (messageBuffer.length >= MAX_BUFFER_SIZE) {
          console.warn('STT buffer overflow, closing client connection');
          clientWs.close(1008, 'Buffer overflow');
          return;
        }
        messageBuffer.push(data);
      }
    });

    clientWs.on('close', () => {
      clearTimeout(authTimeout);
      funasrWs?.close();
    });
  });

  console.log('STT WebSocket proxy enabled at /ws-stt');
}
