import WebSocket from 'ws';

// Server-side WebSocket proxy for FunASR STT
// Clients connect to /ws-stt, server relays to FunASR with credentials
export function setupSTTProxy(server) {
  const url = process.env.FUNASR_API_URL;
  const key = process.env.FUNASR_API_KEY;

  if (!url || !key) {
    console.log('FunASR not configured, STT proxy disabled');
    return;
  }

  const wss = new WebSocket.Server({ server, path: '/ws-stt' });

  wss.on('connection', (clientWs) => {
    let funasrWs = null;

    try {
      const separator = url.includes('?') ? '&' : '?';
      const authenticatedUrl = `${url}${separator}token=${encodeURIComponent(key)}`;
      funasrWs = new WebSocket(authenticatedUrl);
      funasrWs.binaryType = 'arraybuffer';

      funasrWs.on('open', () => {
        // Relay client messages to FunASR
        clientWs.on('message', (data) => {
          if (funasrWs.readyState === WebSocket.OPEN) {
            funasrWs.send(data);
          }
        });
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
