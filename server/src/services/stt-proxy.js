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

  wss.on('connection', (clientWs, req) => {
    // Authenticate: require valid reconnectToken from active player
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const token = urlParams.get('token');
    const roomId = urlParams.get('roomId');

    if (!token || !roomId) {
      clientWs.close(1008, 'Missing authentication');
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      clientWs.close(1008, 'Invalid room');
      return;
    }

    // Verify token matches a connected player in this room
    const validPlayer = room.state.humanPlayers.find(
      p => p.reconnectToken === token && p.connected
    );
    if (!validPlayer) {
      clientWs.close(1008, 'Invalid token');
      return;
    }

    let funasrWs = null;
    let messageBuffer = [];

    try {
      const separator = url.includes('?') ? '&' : '?';
      const authenticatedUrl = `${url}${separator}token=${encodeURIComponent(key)}`;
      funasrWs = new WebSocket(authenticatedUrl);
      funasrWs.binaryType = 'arraybuffer';

      // Buffer client messages until FunASR connects
      clientWs.on('message', (data) => {
        if (funasrWs.readyState === WebSocket.OPEN) {
          funasrWs.send(data);
        } else {
          messageBuffer.push(data);
        }
      });

      funasrWs.on('open', () => {
        // Notify client that upstream is ready
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'ready' }));
        }
        // Flush buffered messages
        for (const data of messageBuffer) {
          funasrWs.send(data);
        }
        messageBuffer = [];
      });

      funasrWs.on('message', (data) => {
        // Relay FunASR results back to client
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      funasrWs.on('error', (err) => {
        console.error('FunASR connection error:', err);
        clientWs.close();
      });

      funasrWs.on('close', () => {
        clientWs.close();
      });

      clientWs.on('close', () => {
        funasrWs.close();
      });

      clientWs.on('error', (err) => {
        console.error('STT client error:', err);
        funasrWs.close();
      });
    } catch (err) {
      console.error('Failed to create FunASR connection:', err);
      clientWs.close();
    }
  });

  console.log('STT WebSocket proxy enabled at /ws-stt');
}
