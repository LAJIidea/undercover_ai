import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  createRoom, getRoom, joinRoom, configureGame,
  startGame, submitDiscussion, submitQuestion,
  submitGuess, submitVote, getPublicState, calculateRoundScores,
} from '../game/engine.js';

const clients = new Map(); // ws -> { id, roomId, type }

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4().slice(0, 8);
    clients.set(ws, { id: clientId, roomId: null, type: null });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        sendError(ws, 'Invalid message format');
        return;
      }
      try {
        handleMessage(ws, msg);
      } catch (err) {
        console.error('Message handler error:', err);
        sendError(ws, 'Server error processing request');
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client?.roomId && client?.playerId) {
        const room = getRoom(client.roomId);
        if (room) {
          const player = room.state.humanPlayers.find(p => p.id === client.playerId);
          if (player) player.connected = false;

          // If captain disconnects, reassign to another connected observe team member
          // Check in any phase after round starts (discussion/questioning/guessing/voting)
          const round = room.state.rounds[room.state.rounds.length - 1];
          if (round?.captainId === client.playerId) {
            const connectedObservers = round.observeTeamPlayers.filter(pid => {
              const p = room.state.humanPlayers.find(h => h.id === pid);
              return p?.connected || pid.startsWith('ai_');
            });
            if (connectedObservers.length > 0) {
              round.captainId = connectedObservers[Math.floor(Math.random() * connectedObservers.length)];
              console.log(`Captain disconnected, reassigned to ${round.captainId}`);
            } else {
              // No connected observers left - if in voting phase, auto-vote to unblock
              if (room.state.phase === 'voting') {
                console.log('Last observer disconnected during voting, auto-voting to unblock');
                const targetId = round.gameTeamPlayers[Math.floor(Math.random() * round.gameTeamPlayers.length)];
                round.voteTarget = targetId;
                round.voteCorrect = targetId === round.omniscientId;
                calculateRoundScores(room);
              }
            }
          }

          // If current speaker disconnects during questioning, skip to next speaker
          if (room.state.phase === 'questioning' && round) {
            const currentSpeaker = round.gameTeamPlayers[round.currentSpeakerIndex];
            if (currentSpeaker === client.playerId) {
              // Find next connected speaker
              let nextIndex = (round.currentSpeakerIndex + 1) % round.gameTeamPlayers.length;
              let attempts = 0;
              let found = false;
              while (attempts < round.gameTeamPlayers.length) {
                const nextSpeakerId = round.gameTeamPlayers[nextIndex];
                const nextPlayer = room.state.humanPlayers.find(h => h.id === nextSpeakerId);
                if (nextPlayer?.connected || nextSpeakerId.startsWith('ai_')) {
                  round.currentSpeakerIndex = nextIndex;
                  console.log(`Speaker disconnected, skipped to index ${nextIndex}`);
                  found = true;
                  break;
                }
                nextIndex = (nextIndex + 1) % round.gameTeamPlayers.length;
                attempts++;
              }
              // If no connected speakers found, end questioning early
              if (!found) {
                console.log('All speakers disconnected, ending questioning');
                submitGuess(room.state.roomId, round.gameTeamPlayers[0], '');
              }
            }
          }

          room.broadcast?.({
            type: 'player_disconnected',
            playerId: client.playerId,
            state: getPublicState(room.state),
          });
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
        const result = createRoom(client.id);
        const roomId = result.roomId;
        const hostToken = result.hostToken;
        client.roomId = roomId;
        client.type = msg.clientType || 'display';
        const room = getRoom(roomId);
        room.broadcast = (data) => broadcastToRoom(roomId, data);
        send(ws, { type: 'room_created', roomId, hostToken, state: getPublicState(room.state) });
        break;
      }

      case 'join_room': {
        const { roomId, playerName, clientType, reconnectToken } = msg;
        try {
          const room = getRoom(roomId);
          if (!room) {
            sendError(ws, 'Room not found');
            break;
          }
          if (!room.broadcast) {
            room.broadcast = (data) => broadcastToRoom(roomId, data);
          }
          // Leave previous room if switching rooms
          if (client.roomId && client.roomId !== roomId && client.playerId) {
            const oldRoom = getRoom(client.roomId);
            if (oldRoom) {
              const oldPlayer = oldRoom.state.humanPlayers.find(p => p.id === client.playerId);
              if (oldPlayer) oldPlayer.connected = false;
            }
          }
          // joinRoom returns { playerId, reconnectToken }
          const result = joinRoom(roomId, { id: client.id, name: playerName, reconnectToken });
          const playerId = result.playerId;
          // Only associate client with room after successful join
          client.roomId = roomId;
          client.playerId = playerId;
          client.type = clientType || 'player';
          send(ws, {
            type: 'joined',
            playerId,
            reconnectToken: result.reconnectToken,
            state: getPublicState(room.state, playerId),
          });
        } catch (err) {
          sendError(ws, err.message);
        }
        break;
      }

      case 'configure': {
        const room = getRoom(client.roomId);
        if (!room || room.hostId !== client.id) {
          sendError(ws, 'Only host can configure game');
          break;
        }
        try {
          configureGame(client.roomId, msg.config);
          send(ws, { type: 'configured' });
        } catch (err) {
          sendError(ws, err.message);
        }
        break;
      }

      case 'start_game': {
        const room = getRoom(client.roomId);
        if (!room || room.hostId !== client.id) {
          sendError(ws, 'Only host can start game');
          break;
        }
        startGame(client.roomId).catch(err => sendError(ws, err.message));
        break;
      }

      case 'discuss': {
        submitDiscussion(client.roomId, client.playerId, msg.message);
        break;
      }

      case 'question': {
        submitQuestion(client.roomId, client.playerId, msg.question);
        break;
      }

      case 'guess': {
        submitGuess(client.roomId, client.playerId, msg.word);
        break;
      }

      case 'vote': {
        submitVote(client.roomId, client.playerId, msg.targetId);
        break;
      }

      case 'get_state': {
        const roomId = msg.roomId || client.roomId;
        const room = getRoom(roomId);
        if (room) {
          // Re-associate client with room if not already (for reconnect recovery)
          if (!client.roomId && roomId) {
            client.roomId = roomId;
            client.type = msg.clientType || 'display';
            // If display reconnecting with valid hostToken, restore host privileges
            if (client.type === 'display' && msg.hostToken && msg.hostToken === room.hostToken) {
              room.hostId = client.id;
              console.log('Host reconnected, privileges restored');
            }
          }
          send(ws, {
            type: 'state_update',
            state: getPublicState(room.state, client.playerId),
          });
        } else {
          sendError(ws, 'Room not found or expired');
        }
        break;
      }

      default:
        sendError(ws, `Unknown message type: ${msg.type}`);
    }
  }

  function broadcastToRoom(roomId, data) {
    const room = getRoom(roomId);
    if (!room) return; // Room deleted, skip broadcast

    for (const [ws, client] of clients) {
      if (client.roomId === roomId && ws.readyState === 1) {
        // Send personalized state for players using stable playerId
        if (data.state && client.type === 'player' && client.playerId) {
          const personalData = { ...data, state: getPublicState(room.state, client.playerId) };
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
