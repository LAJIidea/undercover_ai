import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AI module
vi.mock('../ai/agent-manager.js', () => ({
  getAIResponse: vi.fn(async (type, ctx) => {
    if (type === 'host') return '是';
    if (type === 'observer_vote') return ctx.gameTeamPlayers[0];
    if (type === 'guesser_guess') return 'SKIP';
    return '测试';
  }),
}));

vi.mock('../ai/openrouter.js', () => ({
  isValidModel: vi.fn(() => true),
  validateApiKey: vi.fn(() => null),
  preflightApiKeyCheck: vi.fn(async () => null),
  callOpenRouter: vi.fn(async () => '测试词语'),
  getAllModels: vi.fn(() => []),
  MODEL_PROVIDERS: {},
}));

import { createRoom, getRoom, joinRoom, configureGame, submitVote, submitGuess } from '../game/engine.js';
import { GamePhase } from '../game/state.js';

// Helper to create a room and manually set up a round in voting phase
function createTestRound(roundNumber, opts = {}) {
  const isAiGameTeam = roundNumber % 2 === 1;
  return {
    roundNumber,
    word: opts.word || '苹果',
    wordCategory: '食物',
    gameTeamType: isAiGameTeam ? 'ai' : 'human',
    observeTeamType: isAiGameTeam ? 'human' : 'ai',
    gameTeamPlayers: isAiGameTeam
      ? ['ai_0', 'ai_1', 'ai_2', 'ai_3']
      : ['human_0', 'human_1', 'human_2', 'human_3'],
    observeTeamPlayers: isAiGameTeam
      ? ['human_0', 'human_1', 'human_2', 'human_3']
      : ['ai_0', 'ai_1', 'ai_2', 'ai_3'],
    omniscientId: isAiGameTeam ? 'ai_0' : 'human_0',
    captainId: isAiGameTeam ? 'human_0' : 'ai_0',
    questions: [],
    discussions: [],
    questionCount: opts.questionCount || 5,
    currentSpeakerIndex: 0,
    questionStartTime: Date.now(),
    guessAttempt: opts.guessAttempt || null,
    guessCorrect: opts.guessCorrect || false,
    voteTarget: null,
    voteCorrect: false,
    scores: { gameTeam: 0, observeTeam: 0 },
  };
}

function setupRoomForScoring() {
  const roomId = createRoom();
  const room = getRoom(roomId);
  room.broadcast = vi.fn();

  for (let i = 0; i < 4; i++) {
    joinRoom(roomId, { id: `human_${i}`, name: `P${i}` });
  }
  configureGame(roomId, {
    aiPlayers: [
      { model: 'openai/gpt-4o' }, { model: 'openai/gpt-4o' },
      { model: 'openai/gpt-4o' }, { model: 'openai/gpt-4o' },
    ],
    hostModel: 'openai/gpt-4o',
  });

  return { roomId, room };
}

describe('Scoring Logic', () => {
  it('game team gets +1 for guessing word correctly', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    // Setup round 1: AI is game team, human is observe team
    const round1 = createTestRound(1, { guessCorrect: true });
    state.rounds = [round1];
    state.currentRound = 1;
    state.phase = GamePhase.VOTING;

    // Captain (human_0) votes wrong person
    submitVote(roomId, 'human_0', 'ai_1');

    // AI game team gets +1 for correct guess, observe team gets 0 for wrong vote
    expect(state.scores.ai).toBe(1);
    expect(state.scores.human).toBe(0);
  });

  it('observe team gets +1 for guessing omniscient correctly', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    const round1 = createTestRound(1);
    state.rounds = [round1];
    state.currentRound = 1;
    state.phase = GamePhase.VOTING;

    // Captain votes correctly (omniscient is ai_0)
    submitVote(roomId, 'human_0', 'ai_0');

    expect(state.scores.human).toBe(1); // observe team
    expect(state.scores.ai).toBe(0);    // game team (didn't guess word)
  });

  it('both teams score when both guess correctly', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    const round1 = createTestRound(1, { guessCorrect: true });
    state.rounds = [round1];
    state.currentRound = 1;
    state.phase = GamePhase.VOTING;

    submitVote(roomId, 'human_0', 'ai_0');

    expect(state.scores.ai).toBe(1);    // guessed word
    expect(state.scores.human).toBe(1); // guessed omniscient
  });

  it('fewer questions bonus: round1↔round2 when both fail to find omniscient', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    // Round 1: AI game team, 8 questions, vote wrong
    const round1 = createTestRound(1, { questionCount: 8 });
    round1.voteTarget = 'ai_1';
    round1.voteCorrect = false;
    round1.scores = { gameTeam: 0, observeTeam: 0 };

    // Round 2: Human game team, 5 questions, about to vote wrong
    const round2 = createTestRound(2, { questionCount: 5 });

    state.rounds = [round1, round2];
    state.currentRound = 2;
    state.phase = GamePhase.VOTING;
    // Reset scores from round1 settling
    state.scores = { ai: 0, human: 0 };

    // Captain (ai_0) votes wrong person
    submitVote(roomId, 'ai_0', 'human_1');

    // Round 2's game team (human) used fewer questions (5 < 8), so human gets bonus
    expect(state.scores.human).toBe(1);
    expect(state.scores.ai).toBe(0);
  });

  it('fewer questions bonus: round2↔round3 also works', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    // Round 1: AI game team, 8 questions, vote CORRECT (no bonus triggered)
    const round1 = createTestRound(1, { questionCount: 8 });
    round1.voteTarget = 'ai_0';
    round1.voteCorrect = true;
    round1.scores = { gameTeam: 0, observeTeam: 1 };

    // Round 2: Human game team, 6 questions, vote wrong
    const round2 = createTestRound(2, { questionCount: 6 });
    round2.voteTarget = 'human_1';
    round2.voteCorrect = false;
    round2.scores = { gameTeam: 0, observeTeam: 0 };

    // Round 3: AI game team, 4 questions, about to vote wrong
    const round3 = createTestRound(3, { questionCount: 4 });

    state.rounds = [round1, round2, round3];
    state.currentRound = 3;
    state.phase = GamePhase.VOTING;
    state.scores = { ai: 0, human: 1 }; // human got 1 from round1 correct vote

    // Captain (human_0) votes wrong
    submitVote(roomId, 'human_0', 'ai_1');

    // Round 3 (AI game team, 4 questions) vs round 2 (human, 6 questions)
    // AI used fewer questions → AI gets bonus
    expect(state.scores.ai).toBe(1);
  });

  it('no bonus when both rounds have equal question counts', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    const round1 = createTestRound(1, { questionCount: 5 });
    round1.voteTarget = 'ai_1';
    round1.voteCorrect = false;
    round1.scores = { gameTeam: 0, observeTeam: 0 };

    const round2 = createTestRound(2, { questionCount: 5 });

    state.rounds = [round1, round2];
    state.currentRound = 2;
    state.phase = GamePhase.VOTING;
    state.scores = { ai: 0, human: 0 };

    submitVote(roomId, 'ai_0', 'human_1');

    // Equal questions = no bonus
    expect(state.scores.ai).toBe(0);
    expect(state.scores.human).toBe(0);
  });

  it('no bonus when one round vote was correct', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    // Round 1: vote correct
    const round1 = createTestRound(1, { questionCount: 8 });
    round1.voteTarget = 'ai_0';
    round1.voteCorrect = true;
    round1.scores = { gameTeam: 0, observeTeam: 1 };

    // Round 2: vote wrong, fewer questions
    const round2 = createTestRound(2, { questionCount: 3 });

    state.rounds = [round1, round2];
    state.currentRound = 2;
    state.phase = GamePhase.VOTING;
    state.scores = { ai: 0, human: 1 };

    submitVote(roomId, 'ai_0', 'human_1');

    // Round 1 voted correctly, so no bonus comparison
    expect(state.scores.ai).toBe(0);
    expect(state.scores.human).toBe(1); // only from round 1 observe
  });

  it('timeout without guess means game team gets 0', () => {
    const { roomId, room } = setupRoomForScoring();
    const state = room.state;

    // No guess attempt, no correct guess
    const round1 = createTestRound(1, { guessCorrect: false });
    state.rounds = [round1];
    state.currentRound = 1;
    state.phase = GamePhase.VOTING;

    submitVote(roomId, 'human_0', 'ai_1');

    expect(state.scores.ai).toBe(0); // game team didn't guess
  });
});
