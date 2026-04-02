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

export function createRoom() {
  const roomId = uuidv4().slice(0, 6).toUpperCase();
  const state = createInitialGameState(roomId);
  rooms.set(roomId, { state, broadcast: null, timers: {} });
  return roomId;
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
    humanPlayers: state.humanPlayers,
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
      : round.gameTeamPlayers.includes(playerId) ? 'guesser'
      : round.captainId === playerId ? 'captain'
      : 'observer';
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
  const phase = room.state.phase;
  if (phase !== GamePhase.WAITING && phase !== GamePhase.CONFIGURING) {
    throw new Error('Game already started');
  }
  if (room.state.humanPlayers.length >= 4) throw new Error('Room is full');
  if (room.state.humanPlayers.some(p => p.id === player.id)) return;

  room.state.humanPlayers.push({
    id: player.id,
    name: player.name,
    connected: true,
  });
  room.broadcast?.({ type: 'player_joined', player, state: getPublicState(room.state) });
}

export function configureGame(roomId, config) {
  const room = getRoom(roomId);
  if (!room) throw new Error('Room not found');

  if (config.aiPlayers) {
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
  if (room.state.humanPlayers.length < 4) throw new Error('Need 4 human players');

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

  const round = createRoundState(state.currentRound, state);

  // Select word
  const { word, category } = await selectWord(state.wordConfig, state.aiConfig.hostModel);
  round.word = word;
  round.wordCategory = category;

  state.rounds.push(round);
  transition(room, GamePhase.WORD_ASSIGNMENT);

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
  transition(room, GamePhase.QUESTIONING);
  const round = getCurrentRound(room.state);
  round.questionStartTime = Date.now();

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

  // Check time limit
  const elapsed = Date.now() - round.questionStartTime;
  if (elapsed >= QUESTION_TIME_LIMIT_MS) {
    endQuestioning(room);
    return;
  }

  round.questionCount++;
  round.questions.push({
    playerId,
    question,
    answer: null,
    timestamp: Date.now(),
  });

  // Get host AI answer
  answerQuestion(room, question, round.questions.length - 1);

  // Advance to next speaker
  round.currentSpeakerIndex = (round.currentSpeakerIndex + 1) % round.gameTeamPlayers.length;

  // Start discussion before next question
  room.broadcast?.({ type: 'question_submitted', state: getPublicState(room.state) });
}

async function answerQuestion(room, question, questionIndex) {
  const round = getCurrentRound(room.state);
  try {
    const answer = await getAIResponse('host', {
      word: round.word,
      category: round.wordCategory,
      question,
      model: room.state.aiConfig.hostModel,
    });
    round.questions[questionIndex].answer = answer;
    room.broadcast?.({
      type: 'host_answer',
      questionIndex,
      answer,
      state: getPublicState(room.state),
    });
  } catch (err) {
    console.error('Host AI error:', err);
    // Maintain yes/no constraint even on failure - default to "否"
    round.questions[questionIndex].answer = '否';
    room.broadcast?.({ type: 'host_answer', questionIndex, answer: '否' });
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

function calculateRoundScores(room) {
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
      round.discussions.push({ playerId, message, timestamp: Date.now() });
      room.broadcast?.({ type: 'discussion_message', playerId, message });
    } catch (err) {
      console.error(`AI discussion error for ${playerId}:`, err);
    }
  }
}

async function triggerAIDiscussionMini(room) {
  const round = getCurrentRound(room.state);
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
      round.discussions.push({ playerId, message, timestamp: Date.now() });
      room.broadcast?.({ type: 'discussion_message', playerId, message });
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
