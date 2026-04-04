import { v4 as uuidv4 } from 'uuid';
import {
  GamePhase,
  canTransition,
  createInitialGameState,
  createRoundState,
  QUESTION_TIME_LIMIT_MS,
  DISCUSSION_TIME_MS,
} from './state.js';
import { selectWord, hasAvailableWords } from './words.js';
import { getAIResponse } from '../ai/agent-manager.js';
import { isValidModel, validateApiKey, preflightApiKeyCheck } from '../ai/openrouter.js';

const rooms = new Map();

export function createRoom(hostId) {
  const roomId = uuidv4().slice(0, 6).toUpperCase();
  const hostToken = uuidv4();
  const state = createInitialGameState(roomId);
  rooms.set(roomId, { state, broadcast: null, timers: {}, hostId, hostToken });
  return { roomId, hostToken };
}

export function getRoom(roomId) {
  return rooms.get(roomId);
}

export function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    Object.values(room.timers).forEach(clearTimeout);
    rooms.delete(roomId);
  }
}

function transition(room, newPhase) {
  const state = room.state;
  if (!canTransition(state.phase, newPhase)) {
    throw new Error(`Invalid transition: ${state.phase} → ${newPhase}`);
  }
  state.phase = newPhase;
  room.broadcast?.({ type: 'phase_change', phase: newPhase, state: getPublicState(state) });
}

export function getPublicState(state, playerId = null) {
  const round = state.rounds[state.currentRound - 1];
  const base = {
    roomId: state.roomId,
    phase: state.phase,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    scores: state.scores,
    aiPlayers: state.aiConfig.players.map(p => ({
      id: p.id, name: p.name, personality: p.personality,
    })),
    humanPlayers: state.humanPlayers.map(p => ({
      id: p.id, name: p.name, connected: p.connected,
    })),
    aiConfig: {
      players: state.aiConfig.players.map(p => ({
        model: p.model, personality: p.personality,
      })),
      hostModel: state.aiConfig.hostModel,
    },
    wordConfig: {
      mode: state.wordConfig.mode,
      aiRatio: state.wordConfig.aiRatio,
    },
  };

  if (!round) return base;

  const roundPublic = {
    roundNumber: round.roundNumber,
    gameTeamType: round.gameTeamType,
    observeTeamType: round.observeTeamType,
    gameTeamPlayers: round.gameTeamPlayers,
    observeTeamPlayers: round.observeTeamPlayers,
    captainId: round.captainId,
    questions: round.questions,
    discussions: round.discussions,
    questionCount: round.questionCount,
    currentSpeakerIndex: round.currentSpeakerIndex,
    questionStartTime: round.questionStartTime,
    discussionStartTime: round.discussionStartTime,
    guessAttempt: round.guessAttempt,
    guessCorrect: state.phase === GamePhase.ROUND_RESULT ? round.guessCorrect : undefined,
    voteTarget: state.phase === GamePhase.ROUND_RESULT ? round.voteTarget : undefined,
    voteCorrect: state.phase === GamePhase.ROUND_RESULT ? round.voteCorrect : undefined,
    roundScores: state.phase === GamePhase.ROUND_RESULT ? round.scores : undefined,
  };

  // Word visibility: observers always see, omniscient sees, others don't
  if (playerId) {
    const isObserver = round.observeTeamPlayers.includes(playerId);
    const isOmniscient = round.omniscientId === playerId;
    if (isObserver || isOmniscient) {
      roundPublic.word = round.word;
      roundPublic.wordCategory = round.wordCategory;
    }
    roundPublic.myRole = isOmniscient ? 'omniscient'
      : round.captainId === playerId ? 'captain'
      : round.gameTeamPlayers.includes(playerId) ? 'guesser'
      : isObserver ? 'observer'
      : 'spectator';
  }

  // Reveal word and omniscient at round result
  if (state.phase === GamePhase.ROUND_RESULT || state.phase === GamePhase.GAME_OVER) {
    roundPublic.word = round.word;
    roundPublic.wordCategory = round.wordCategory;
    roundPublic.omniscientId = round.omniscientId;
  }

  return { ...base, round: roundPublic };
}

export function joinRoom(roomId, player) {
  const room = getRoom(roomId);
  if (!room) throw new Error('Room not found');

  // Check if this player is already in the room (by id)
  const existing = room.state.humanPlayers.find(p => p.id === player.id);
  if (existing) {
    existing.connected = true;
    return { playerId: player.id, reconnectToken: existing.reconnectToken };
  }

  // Allow reconnection: if a player with the same name is disconnected, restore them
  // Require reconnectToken to prevent impersonation
  const disconnectedPlayer = room.state.humanPlayers.find(
    p => p.name === player.name && !p.connected
  );
  if (disconnectedPlayer) {
    // Verify reconnectToken if provided
    if (player.reconnectToken && player.reconnectToken === disconnectedPlayer.reconnectToken) {
      disconnectedPlayer.connected = true;
      room.broadcast?.({ type: 'player_joined', player: { id: disconnectedPlayer.id, name: disconnectedPlayer.name }, state: getPublicState(room.state) });
      return { playerId: disconnectedPlayer.id, reconnectToken: disconnectedPlayer.reconnectToken };
    } else if (player.reconnectToken) {
      // Token provided but wrong
      throw new Error('Invalid reconnect token');
    }
    // No token provided - reject reconnection to prevent impersonation
    throw new Error('Reconnection requires token');
  }

  // Only allow new joins before game starts
  const phase = room.state.phase;
  if (phase !== GamePhase.WAITING && phase !== GamePhase.CONFIGURING) {
    throw new Error('Game already started');
  }

  // Reject duplicate player names to avoid reconnect token conflicts
  if (room.state.humanPlayers.some(p => p.name === player.name && p.connected)) {
    throw new Error('Player name already taken');
  }

  // Count only connected players for capacity check
  const connectedCount = room.state.humanPlayers.filter(p => p.connected).length;
  if (connectedCount >= 4) throw new Error('Room is full');
  if (room.state.humanPlayers.length >= 4) {
    // All 4 slots taken but some disconnected — remove oldest disconnected to make room
    const dcIdx = room.state.humanPlayers.findIndex(p => !p.connected);
    if (dcIdx !== -1) {
      room.state.humanPlayers.splice(dcIdx, 1);
    } else {
      throw new Error('Room is full');
    }
  }

  // Generate reconnect token for new player
  const reconnectToken = uuidv4();
  room.state.humanPlayers.push({
    id: player.id,
    name: player.name,
    connected: true,
    reconnectToken,
  });
  room.broadcast?.({ type: 'player_joined', player, state: getPublicState(room.state) });
  return { playerId: player.id, reconnectToken };
}

export function configureGame(roomId, config) {
  const room = getRoom(roomId);
  if (!room) throw new Error('Room not found');

  if (config.aiPlayers) {
    if (!Array.isArray(config.aiPlayers) || config.aiPlayers.length > 4) {
      throw new Error('aiPlayers must be an array with at most 4 elements');
    }
    config.aiPlayers.forEach((aiConf, i) => {
      if (aiConf.model) {
        if (!isValidModel(aiConf.model)) {
          throw new Error(`Invalid model: ${aiConf.model}`);
        }
        room.state.aiConfig.players[i].model = aiConf.model;
      }
      if (aiConf.name) room.state.aiConfig.players[i].name = aiConf.name;
      if (aiConf.personality) room.state.aiConfig.players[i].personality = aiConf.personality;
    });
  }
  if (config.hostModel) {
    if (!isValidModel(config.hostModel)) {
      throw new Error(`Invalid host model: ${config.hostModel}`);
    }
    room.state.aiConfig.hostModel = config.hostModel;
  }
  if (config.wordConfig) Object.assign(room.state.wordConfig, config.wordConfig);

  if (room.state.phase === GamePhase.WAITING) {
    transition(room, GamePhase.CONFIGURING);
  }
  room.broadcast?.({ type: 'config_updated', state: getPublicState(room.state) });
}

export async function startGame(roomId) {
  const room = getRoom(roomId);
  if (!room) throw new Error('Room not found');
  const connectedHumans = room.state.humanPlayers.filter(p => p.connected);
  if (connectedHumans.length < 4) throw new Error('Need 4 connected human players');

  // Validate AI config
  const allModels = room.state.aiConfig.players.every(p => p.model);
  if (!allModels || !room.state.aiConfig.hostModel) {
    throw new Error('All AI players and host must have models configured');
  }

  // Validate all model IDs against whitelist
  for (const p of room.state.aiConfig.players) {
    if (!isValidModel(p.model)) throw new Error(`Invalid model: ${p.model}`);
  }
  if (!isValidModel(room.state.aiConfig.hostModel)) {
    throw new Error(`Invalid host model: ${room.state.aiConfig.hostModel}`);
  }

  // Validate OpenRouter API key format
  const keyError = validateApiKey();
  if (keyError) throw new Error(keyError);

  // Pre-flight: verify key is actually usable with a real API call
  const preflightError = await preflightApiKeyCheck();
  if (preflightError) throw new Error(preflightError);

  // Validate word source availability
  if (!hasAvailableWords(room.state.wordConfig)) {
    throw new Error('No word source available. Configure preset words or enable AI generation.');
  }

  if (room.state.phase === GamePhase.WAITING) {
    transition(room, GamePhase.CONFIGURING);
  }
  transition(room, GamePhase.ROUND_START);
  await startRound(room);
}

async function startRound(room) {
  const state = room.state;
  state.currentRound++;

  if (state.currentRound > state.totalRounds) {
    transition(room, GamePhase.GAME_OVER);
    return;
  }

  try {
    const round = createRoundState(state.currentRound, state);

    // Select word
    const { word, category } = await selectWord(state.wordConfig, state.aiConfig.hostModel);
    round.word = word;
    round.wordCategory = category;

    state.rounds.push(round);
    transition(room, GamePhase.WORD_ASSIGNMENT);
  } catch (err) {
    console.error('Failed to create round state:', err);
    transition(room, GamePhase.GAME_OVER);
    room.timers.cleanup = setTimeout(() => {
      deleteRoom(state.roomId);
    }, 60000);
    return;
  }

  // Brief pause for word assignment display, then move to discussion
  room.timers.wordAssignment = setTimeout(() => {
    startDiscussion(room);
  }, 3000);
}

function startDiscussion(room) {
  // Set timestamp BEFORE transition so the broadcast includes it
  const round = getCurrentRound(room.state);
  round.discussionStartTime = Date.now();

  transition(room, GamePhase.DISCUSSION);

  // Start AI discussion if AI is game team
  if (round.gameTeamType === 'ai') {
    triggerAIDiscussion(room);
  }

  room.timers.discussion = setTimeout(() => {
    startQuestioning(room);
  }, DISCUSSION_TIME_MS);
}

function startQuestioning(room) {
  const round = getCurrentRound(room.state);
  round.questionStartTime = Date.now();

  // Validate current speaker is connected before starting
  let attempts = 0;
  let foundSpeaker = false;
  while (attempts < round.gameTeamPlayers.length) {
    const speakerId = round.gameTeamPlayers[round.currentSpeakerIndex];
    const speaker = room.state.humanPlayers.find(h => h.id === speakerId);
    if (speaker?.connected || speakerId.startsWith('ai_')) {
      foundSpeaker = true;
      break;
    }
    round.currentSpeakerIndex = (round.currentSpeakerIndex + 1) % round.gameTeamPlayers.length;
    attempts++;
  }

  // If no connected speakers, skip directly to voting
  if (!foundSpeaker) {
    console.log('No connected speakers, skipping questioning to voting');
    transition(room, GamePhase.QUESTIONING);
    transition(room, GamePhase.VOTING);
    triggerVoting(room);
    return;
  }

  transition(room, GamePhase.QUESTIONING);

  // 7-minute hard limit
  room.timers.questioning = setTimeout(() => {
    endQuestioning(room);
  }, QUESTION_TIME_LIMIT_MS);

  // If AI is game team, trigger first AI question
  if (round.gameTeamType === 'ai') {
    triggerAIQuestion(room);
  }

  room.broadcast?.({ type: 'questioning_started', state: getPublicState(room.state) });
}

function endQuestioning(room) {
  clearTimeout(room.timers.questioning);
  // Move to voting (skip guessing if time ran out)
  if (room.state.phase === GamePhase.QUESTIONING) {
    transition(room, GamePhase.VOTING);
    triggerVoting(room);
  }
}

export function submitDiscussion(roomId, playerId, message) {
  const room = getRoom(roomId);
  if (!room || room.state.phase !== GamePhase.DISCUSSION) return;

  const round = getCurrentRound(room.state);
  if (!round.gameTeamPlayers.includes(playerId)) return;

  round.discussions.push({ playerId, message, timestamp: Date.now() });
  room.broadcast?.({
    type: 'discussion_message',
    playerId, message,
    state: getPublicState(room.state),
  });
}

export function submitQuestion(roomId, playerId, question) {
  const room = getRoom(roomId);
  if (!room || room.state.phase !== GamePhase.QUESTIONING) return;

  const round = getCurrentRound(room.state);
  if (!round.gameTeamPlayers.includes(playerId)) return;

  // Check turn order
  const expectedSpeaker = round.gameTeamPlayers[round.currentSpeakerIndex];
  if (playerId !== expectedSpeaker) return;

  // Block if still waiting for previous answer
  if (round.waitingForAnswer) return;

  // Check time limit
  const elapsed = Date.now() - round.questionStartTime;
  if (elapsed >= QUESTION_TIME_LIMIT_MS) {
    endQuestioning(room);
    return;
  }

  round.waitingForAnswer = true;
  round.questionCount++;
  const speakerIndexAtQuestion = round.currentSpeakerIndex;
  round.questions.push({
    playerId,
    question,
    answer: null,
    timestamp: Date.now(),
  });

  // Get host AI answer, then advance speaker
  answerQuestion(room, question, round.questions.length - 1).then(() => {
    round.waitingForAnswer = false;
    // Only advance if the speaker index hasn't already been moved (e.g. by disconnect handler)
    if (round.currentSpeakerIndex !== speakerIndexAtQuestion) return;
    // Advance to next connected speaker after answer is received
    let nextIndex = (round.currentSpeakerIndex + 1) % round.gameTeamPlayers.length;
    let attempts = 0;
    while (attempts < round.gameTeamPlayers.length) {
      const nextSpeakerId = round.gameTeamPlayers[nextIndex];
      const nextPlayer = room.state.humanPlayers.find(h => h.id === nextSpeakerId);
      if (nextPlayer?.connected || nextSpeakerId.startsWith('ai_')) {
        round.currentSpeakerIndex = nextIndex;
        break;
      }
      nextIndex = (nextIndex + 1) % round.gameTeamPlayers.length;
      attempts++;
    }
    room.broadcast?.({ type: 'speaker_advanced', state: getPublicState(room.state) });
  });

  // Start discussion before next question
  room.broadcast?.({ type: 'question_submitted', state: getPublicState(room.state) });
}

async function answerQuestion(room, question, questionIndex) {
  const round = getCurrentRound(room.state);
  const expectedRound = room.state.currentRound;
  try {
    const answer = await getAIResponse('host', {
      word: round.word,
      category: round.wordCategory,
      question,
      model: room.state.aiConfig.hostModel,
    });
    // Drop answer if phase moved past questioning
    if (room.state.phase !== GamePhase.QUESTIONING || room.state.currentRound !== expectedRound) {
      console.warn('Host answer arrived after questioning ended, discarding');
      return;
    }
    round.questions[questionIndex].answer = answer;
    room.broadcast?.({
      type: 'host_answer',
      questionIndex,
      answer,
      state: getPublicState(room.state),
    });
  } catch (err) {
    console.error('Host AI error:', err);
    if (room.state.phase !== GamePhase.QUESTIONING || room.state.currentRound !== expectedRound) return;
    // Maintain yes/no constraint even on failure - default to "否"
    round.questions[questionIndex].answer = '否';
    room.broadcast?.({
      type: 'host_answer',
      questionIndex,
      answer: '否',
      state: getPublicState(room.state),
    });
  }

  // After answering, trigger discussion then next AI question if AI is game team
  if (round.gameTeamType === 'ai' && room.state.phase === GamePhase.QUESTIONING) {
    setTimeout(async () => {
      if (room.state.phase !== GamePhase.QUESTIONING) return;

      await triggerAIDiscussionMini(room);

      // After enough questions, attempt AI guess before asking more
      if (round.questionCount >= 5) {
        const guessed = await triggerAIGuess(room);
        if (guessed) return; // Guess was submitted, flow moves to voting
      }

      setTimeout(() => {
        if (room.state.phase === GamePhase.QUESTIONING) {
          triggerAIQuestion(room);
        }
      }, 3000);
    }, 2000);
  }
}

export function submitGuess(roomId, playerId, guessWord) {
  const room = getRoom(roomId);
  if (!room) return;
  if (room.state.phase !== GamePhase.QUESTIONING && room.state.phase !== GamePhase.GUESSING) return;

  const round = getCurrentRound(room.state);
  if (!round.gameTeamPlayers.includes(playerId)) return;

  clearTimeout(room.timers.questioning);

  if (room.state.phase === GamePhase.QUESTIONING) {
    transition(room, GamePhase.GUESSING);
  }

  round.guessAttempt = guessWord;
  round.guessCorrect = guessWord.trim().toLowerCase() === round.word.trim().toLowerCase();

  room.broadcast?.({ type: 'guess_submitted', guessWord, state: getPublicState(room.state) });

  // Move to voting
  transition(room, GamePhase.VOTING);
  triggerVoting(room);
}

function triggerVoting(room) {
  const round = getCurrentRound(room.state);

  // If observe team is AI, auto-vote
  if (round.observeTeamType === 'ai') {
    triggerAIVote(room);
  } else {
    // Human observe team: check if captain is still connected
    const captain = room.state.humanPlayers.find(p => p.id === round.captainId);
    if (!captain?.connected) {
      // Try to reassign to another connected observer
      const connectedObservers = round.observeTeamPlayers.filter(pid => {
        const p = room.state.humanPlayers.find(h => h.id === pid);
        return p?.connected;
      });
      if (connectedObservers.length > 0) {
        round.captainId = connectedObservers[Math.floor(Math.random() * connectedObservers.length)];
      } else {
        // No connected observers: auto-vote to prevent deadlock
        console.log('No connected observers at voting start, auto-voting');
        const targetId = round.gameTeamPlayers[Math.floor(Math.random() * round.gameTeamPlayers.length)];
        round.voteTarget = targetId;
        round.voteCorrect = targetId === round.omniscientId;
        calculateRoundScores(room);
        return;
      }
    }
  }

  room.broadcast?.({ type: 'voting_started', state: getPublicState(room.state) });
}

export function submitVote(roomId, playerId, targetId) {
  const room = getRoom(roomId);
  if (!room || room.state.phase !== GamePhase.VOTING) return;

  const round = getCurrentRound(room.state);
  // Only captain can make final decision
  if (playerId !== round.captainId) return;
  if (!round.gameTeamPlayers.includes(targetId)) return;

  round.voteTarget = targetId;
  round.voteCorrect = targetId === round.omniscientId;

  // Calculate round scores
  calculateRoundScores(room);
}

export function calculateRoundScores(room) {
  const state = room.state;
  const round = getCurrentRound(state);

  // Game team guessed word correctly: +1
  if (round.guessCorrect) {
    round.scores.gameTeam += 1;
  }

  // Observe team guessed omniscient correctly: +1
  if (round.voteCorrect) {
    round.scores.observeTeam += 1;
  }

  // "Both teams failed to find omniscient" bonus: compare with previous round.
  // Rule: When both the current round AND the previous round have voteCorrect=false,
  // the team that used fewer questions gets +1.
  // Each round can participate as "previous" in at most one comparison,
  // but can always be the "current" round in a new comparison.
  // We track this via `usedAsPrevForBonus` on the previous round only.
  if (!round.voteCorrect && state.rounds.length >= 2) {
    const prevRound = state.rounds[state.rounds.length - 2];
    if (!prevRound.voteCorrect && !prevRound.usedAsPrevForBonus) {
      let bonusTeamType = null;
      if (round.questionCount < prevRound.questionCount) {
        bonusTeamType = round.gameTeamType;
      } else if (prevRound.questionCount < round.questionCount) {
        bonusTeamType = prevRound.gameTeamType;
      }
      // Equal question counts = no bonus

      if (bonusTeamType) {
        if (bonusTeamType === 'ai') {
          state.scores.ai += 1;
        } else {
          state.scores.human += 1;
        }
      }
      // Mark only the previous round so it can't be used as "prev" again,
      // but the current round is NOT marked - it can still be "prev" for the next round.
      prevRound.usedAsPrevForBonus = true;
    }
  }

  // Apply current round's scores to total
  if (round.gameTeamType === 'ai') {
    state.scores.ai += round.scores.gameTeam;
    state.scores.human += round.scores.observeTeam;
  } else {
    state.scores.human += round.scores.gameTeam;
    state.scores.ai += round.scores.observeTeam;
  }

  transition(room, GamePhase.ROUND_RESULT);
  room.broadcast?.({ type: 'round_result', state: getPublicState(room.state) });

  // Auto-advance to next round after delay
  room.timers.roundResult = setTimeout(() => {
    if (state.currentRound >= state.totalRounds) {
      transition(room, GamePhase.GAME_OVER);
      room.broadcast?.({ type: 'game_over', state: getPublicState(room.state) });
      // Clean up room after delay to allow clients to see final state
      room.timers.cleanup = setTimeout(() => {
        deleteRoom(state.roomId);
      }, 60000); // 1 minute grace period
    } else {
      transition(room, GamePhase.ROUND_START);
      startRound(room);
    }
  }, 8000);
}

function getCurrentRound(state) {
  return state.rounds[state.currentRound - 1];
}

// AI action triggers
async function triggerAIDiscussion(room) {
  const round = getCurrentRound(room.state);
  const expectedPhase = room.state.phase;
  for (const playerId of round.gameTeamPlayers) {
    if (!playerId.startsWith('ai_')) continue;
    try {
      const aiPlayer = room.state.aiConfig.players.find(p => p.id === playerId);
      const isOmniscient = playerId === round.omniscientId;
      const message = await getAIResponse(isOmniscient ? 'omniscient_discuss' : 'guesser_discuss', {
        word: isOmniscient ? round.word : null,
        category: round.wordCategory,
        personality: aiPlayer.personality,
        discussions: round.discussions,
        questions: round.questions,
        model: aiPlayer.model,
      });
      // Only write if still in discussion phase
      if (room.state.phase !== expectedPhase) {
        console.warn(`AI discussion for ${playerId} arrived after phase changed, discarding`);
        continue;
      }
      round.discussions.push({ playerId, message, timestamp: Date.now() });
      room.broadcast?.({ type: 'discussion_message', playerId, message, state: getPublicState(room.state) });
    } catch (err) {
      console.error(`AI discussion error for ${playerId}:`, err);
    }
  }
}

async function triggerAIDiscussionMini(room) {
  const round = getCurrentRound(room.state);
  const expectedPhase = room.state.phase;
  // Pick 1-2 random AI players to comment
  const aiPlayers = round.gameTeamPlayers.filter(id => id.startsWith('ai_'));
  const commenters = aiPlayers.slice(0, Math.floor(Math.random() * 2) + 1);

  for (const playerId of commenters) {
    try {
      const aiPlayer = room.state.aiConfig.players.find(p => p.id === playerId);
      const isOmniscient = playerId === round.omniscientId;
      const message = await getAIResponse(isOmniscient ? 'omniscient_discuss' : 'guesser_discuss', {
        word: isOmniscient ? round.word : null,
        personality: aiPlayer.personality,
        discussions: round.discussions,
        questions: round.questions,
        model: aiPlayer.model,
        brief: true,
      });
      // Only write if still in questioning phase
      if (room.state.phase !== expectedPhase) {
        console.warn(`AI mini-discussion for ${playerId} arrived after phase changed, discarding`);
        continue;
      }
      round.discussions.push({ playerId, message, timestamp: Date.now() });
      room.broadcast?.({ type: 'discussion_message', playerId, message, state: getPublicState(room.state) });
    } catch (err) {
      console.error(`AI mini discussion error for ${playerId}:`, err);
    }
  }
}

async function triggerAIQuestion(room) {
  const round = getCurrentRound(room.state);
  const currentPlayerId = round.gameTeamPlayers[round.currentSpeakerIndex];
  if (!currentPlayerId.startsWith('ai_')) return;

  try {
    const aiPlayer = room.state.aiConfig.players.find(p => p.id === currentPlayerId);
    const isOmniscient = currentPlayerId === round.omniscientId;
    const question = await getAIResponse(isOmniscient ? 'omniscient_question' : 'guesser_question', {
      word: isOmniscient ? round.word : null,
      category: round.wordCategory,
      personality: aiPlayer.personality,
      discussions: round.discussions,
      questions: round.questions,
      model: aiPlayer.model,
    });
    submitQuestion(room.state.roomId, currentPlayerId, question);
  } catch (err) {
    console.error(`AI question error for ${currentPlayerId}:`, err);
    // Skip to next speaker to avoid deadlock
    if (room.state.phase === GamePhase.QUESTIONING) {
      round.waitingForAnswer = false;
      round.currentSpeakerIndex = (round.currentSpeakerIndex + 1) % round.gameTeamPlayers.length;
      room.broadcast?.({ type: 'speaker_advanced', state: getPublicState(room.state) });
      // Schedule next AI question after delay
      setTimeout(() => {
        if (room.state.phase === GamePhase.QUESTIONING) {
          triggerAIQuestion(room);
        }
      }, 2000);
    }
  }
}

async function triggerAIVote(room) {
  const round = getCurrentRound(room.state);
  try {
    const captain = room.state.aiConfig.players.find(p => p.id === round.captainId);
    const targetId = await getAIResponse('observer_vote', {
      word: round.word,
      discussions: round.discussions,
      questions: round.questions,
      gameTeamPlayers: round.gameTeamPlayers,
      omniscientId: round.omniscientId,
      personality: captain?.personality,
      model: captain?.model || room.state.aiConfig.hostModel,
    });
    submitVote(room.state.roomId, round.captainId, targetId);
  } catch (err) {
    console.error('AI vote error:', err);
    // Fallback: random vote
    const randomTarget = round.gameTeamPlayers[Math.floor(Math.random() * round.gameTeamPlayers.length)];
    submitVote(room.state.roomId, round.captainId, randomTarget);
  }
}

// Auto-trigger AI guess if AI is game team and enough info gathered
// Returns true if a guess was submitted
async function triggerAIGuess(room) {
  const round = getCurrentRound(room.state);
  if (round.gameTeamType !== 'ai') return false;
  if (round.questionCount < 3) return false;

  try {
    const guess = await getAIResponse('guesser_guess', {
      discussions: round.discussions,
      questions: round.questions,
      category: round.wordCategory,
      model: room.state.aiConfig.players[0].model,
    });
    if (guess && guess !== 'SKIP') {
      submitGuess(room.state.roomId, round.gameTeamPlayers[0], guess);
      return true;
    }
  } catch (err) {
    console.error('AI guess error:', err);
  }
  return false;
}
