import WebSocket, { WebSocketServer } from 'ws';

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
