import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  createRoom, getRoom, joinRoom, configureGame,
  startGame, submitDiscussion, submitQuestion,
  submitGuess, submitVote, getPublicState,
} from '../game/engine.js';

const clients = new Map(); // ws -> { id, roomId, type }

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4().slice(0, 8);
    clients.set(ws, { id: clientId, roomId: null, type: null });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleMessage(ws, msg);
      } catch (err) {
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client?.roomId) {
        const room = getRoom(client.roomId);
        if (room) {
          const player = room.state.humanPlayers.find(p => p.id === client.id);
          if (player) player.connected = false;
          room.broadcast?.({ type: 'player_disconnected', playerId: client.id });
        }
      }
      clients.delete(ws);
    });

    send(ws, { type: 'connected', clientId });
  });

  function handleMessage(ws, msg) {
    const client = clients.get(ws);

    switch (msg.type) {
      case 'create_room': {
        const roomId = createRoom();
        client.roomId = roomId;
        client.type = msg.clientType || 'display';
        const room = getRoom(roomId);
        room.broadcast = (data) => broadcastToRoom(roomId, data);
        send(ws, { type: 'room_created', roomId, state: getPublicState(room.state) });
        break;
      }

      case 'join_room': {
        const { roomId, playerName, clientType } = msg;
        try {
          const room = getRoom(roomId);
          if (!room) {
            sendError(ws, 'Room not found');
            break;
          }
          const playerId = client.id;
          client.roomId = roomId;
          client.type = clientType || 'player';
          if (!room.broadcast) {
            room.broadcast = (data) => broadcastToRoom(roomId, data);
          }
          joinRoom(roomId, { id: playerId, name: playerName });
          send(ws, {
            type: 'joined',
            playerId,
            state: getPublicState(room.state, playerId),
          });
        } catch (err) {
          sendError(ws, err.message);
        }
        break;
      }

      case 'configure': {
        try {
          configureGame(client.roomId, msg.config);
          send(ws, { type: 'configured' });
        } catch (err) {
          sendError(ws, err.message);
        }
        break;
      }

      case 'start_game': {
        startGame(client.roomId).catch(err => sendError(ws, err.message));
        break;
      }

      case 'discuss': {
        submitDiscussion(client.roomId, client.id, msg.message);
        break;
      }

      case 'question': {
        submitQuestion(client.roomId, client.id, msg.question);
        break;
      }

      case 'guess': {
        submitGuess(client.roomId, client.id, msg.word);
        break;
      }

      case 'vote': {
        submitVote(client.roomId, client.id, msg.targetId);
        break;
      }

      case 'get_state': {
        const room = getRoom(client.roomId);
        if (room) {
          send(ws, {
            type: 'state_update',
            state: getPublicState(room.state, client.id),
          });
        }
        break;
      }

      default:
        sendError(ws, `Unknown message type: ${msg.type}`);
    }
  }

  function broadcastToRoom(roomId, data) {
    for (const [ws, client] of clients) {
      if (client.roomId === roomId && ws.readyState === 1) {
        // Send personalized state for players
        if (data.state && client.type === 'player') {
          const personalData = { ...data, state: getPublicState(getRoom(roomId).state, client.id) };
          send(ws, personalData);
        } else {
          send(ws, data);
        }
      }
    }
  }

  function send(ws, data) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  function sendError(ws, message) {
    send(ws, { type: 'error', message });
  }
}
