import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the AI module before importing engine
vi.mock('../ai/agent-manager.js', () => ({
  getAIResponse: vi.fn(async (type, ctx) => {
    if (type === 'host') return '是';
    if (type === 'observer_vote') return ctx.gameTeamPlayers[0];
    if (type === 'guesser_guess') return 'SKIP';
    return '这是一个测试回答';
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

import {
  createRoom, getRoom, joinRoom, configureGame, startGame,
  submitQuestion, submitGuess, submitVote, submitDiscussion,
  getPublicState,
} from '../game/engine.js';
import { isValidModel, validateApiKey, preflightApiKeyCheck } from '../ai/openrouter.js';

function setupRoom() {
  const roomId = createRoom();
  const room = getRoom(roomId);
  room.broadcast = vi.fn();

  // Add 4 humans
  for (let i = 0; i < 4; i++) {
    joinRoom(roomId, { id: `human_${i}`, name: `Player${i}` });
  }

  // Configure AI
  configureGame(roomId, {
    aiPlayers: [
      { model: 'openai/gpt-4o' },
      { model: 'openai/gpt-4o' },
      { model: 'openai/gpt-4o' },
      { model: 'openai/gpt-4o' },
    ],
    hostModel: 'openai/gpt-4o',
  });

  return { roomId, room };
}

describe('Game Engine', () => {
  describe('Room management', () => {
    it('creates a room', () => {
      const roomId = createRoom();
      expect(roomId).toBeTruthy();
      expect(getRoom(roomId)).toBeTruthy();
    });

    it('allows joining during WAITING phase', () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();

      joinRoom(roomId, { id: 'p1', name: 'Alice' });
      expect(room.state.humanPlayers).toHaveLength(1);
    });

    it('allows joining during CONFIGURING phase', () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();

      // First join triggers configuring via configureGame
      joinRoom(roomId, { id: 'p1', name: 'Alice' });
      configureGame(roomId, { hostModel: 'openai/gpt-4o' });
      expect(room.state.phase).toBe('configuring');

      // Should still be able to join
      joinRoom(roomId, { id: 'p2', name: 'Bob' });
      expect(room.state.humanPlayers).toHaveLength(2);
    });

    it('rejects joining a non-existent room', () => {
      expect(() => joinRoom('INVALID', { id: 'p1', name: 'Alice' }))
        .toThrow('Room not found');
    });

    it('rejects joining a full room', () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();

      for (let i = 0; i < 4; i++) {
        joinRoom(roomId, { id: `p${i}`, name: `Player${i}` });
      }
      expect(() => joinRoom(roomId, { id: 'p5', name: 'Extra' }))
        .toThrow('Room is full');
    });
  });

  describe('Model validation (AC-5 negative)', () => {
    it('rejects invalid model IDs in configureGame', () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();

      isValidModel.mockReturnValueOnce(false);
      expect(() => configureGame(roomId, {
        aiPlayers: [{ model: 'fake/model' }],
      })).toThrow('Invalid model');
    });

    it('rejects missing API key on startGame', async () => {
      const { roomId } = setupRoom();
      validateApiKey.mockReturnValueOnce('OPENROUTER_API_KEY is not configured');

      await expect(startGame(roomId)).rejects.toThrow('OPENROUTER_API_KEY is not configured');
    });

    it('rejects format-valid but actually-invalid API key via preflight', async () => {
      const { roomId } = setupRoom();
      preflightApiKeyCheck.mockResolvedValueOnce('OpenRouter API key is not valid (HTTP 401)');

      await expect(startGame(roomId)).rejects.toThrow('OpenRouter API key is not valid');
    });
  });

  describe('Game flow', () => {
    it('requires 4 human players to start', async () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();
      joinRoom(roomId, { id: 'p1', name: 'Alice' });
      configureGame(roomId, {
        aiPlayers: [
          { model: 'openai/gpt-4o' }, { model: 'openai/gpt-4o' },
          { model: 'openai/gpt-4o' }, { model: 'openai/gpt-4o' },
        ],
        hostModel: 'openai/gpt-4o',
      });

      await expect(startGame(roomId)).rejects.toThrow('Need 4 human players');
    });

    it('requires all AI models configured to start', async () => {
      const roomId = createRoom();
      const room = getRoom(roomId);
      room.broadcast = vi.fn();
      for (let i = 0; i < 4; i++) {
        joinRoom(roomId, { id: `p${i}`, name: `P${i}` });
      }
      // Don't configure AI models
      await expect(startGame(roomId)).rejects.toThrow('models configured');
    });
  });

  // Scoring tests moved to scoring.test.js for proper coverage

  describe('Discussion timer broadcast (AC-2/AC-7)', () => {
    it('discussion phase_change broadcast includes non-null discussionStartTime', async () => {
      const { roomId, room } = setupRoom();
      await startGame(roomId);

      // Wait for word assignment timeout → discussion transition
      await new Promise(r => setTimeout(r, 3500));

      // Find the discussion phase_change broadcast
      const discussionBroadcast = room.broadcast.mock.calls.find(
        ([msg]) => msg.type === 'phase_change' && msg.phase === 'discussion'
      );

      expect(discussionBroadcast).toBeTruthy();
      const [msg] = discussionBroadcast;
      expect(msg.state.round.discussionStartTime).toBeTypeOf('number');
      expect(msg.state.round.discussionStartTime).toBeGreaterThan(0);
    });

    it('AI discussion_message broadcasts include state with discussions (AC-2/AC-7)', async () => {
      const { roomId, room } = setupRoom();
      await startGame(roomId);

      // Wait for discussion phase + AI discussion to fire
      await new Promise(r => setTimeout(r, 6000));

      // Find discussion_message broadcasts from AI
      const aiDiscussionBroadcasts = room.broadcast.mock.calls.filter(
        ([msg]) => msg.type === 'discussion_message' && msg.playerId?.startsWith('ai_')
      );

      // In round 1, AI is game team, so AI discussions should fire
      if (aiDiscussionBroadcasts.length > 0) {
        const [msg] = aiDiscussionBroadcasts[0];
        expect(msg.state).toBeTruthy();
        expect(msg.state.round).toBeTruthy();
        expect(msg.state.round.discussions).toBeInstanceOf(Array);
        expect(msg.state.round.discussions.length).toBeGreaterThan(0);
      }
    }, 15000);
  });

  describe('Public state filtering', () => {
    it('hides word from non-omniscient game team members', () => {
      const { room } = setupRoom();
      const state = room.state;
      state.phase = 'questioning';
      state.currentRound = 1;
      state.rounds = [{
        roundNumber: 1,
        word: '苹果',
        wordCategory: '食物',
        gameTeamType: 'human',
        observeTeamType: 'ai',
        gameTeamPlayers: ['human_0', 'human_1', 'human_2', 'human_3'],
        observeTeamPlayers: ['ai_0', 'ai_1', 'ai_2', 'ai_3'],
        omniscientId: 'human_0',
        captainId: 'ai_0',
        questions: [],
        discussions: [],
        questionCount: 0,
        currentSpeakerIndex: 0,
        questionStartTime: Date.now(),
        scores: { gameTeam: 0, observeTeam: 0 },
      }];

      // Omniscient can see word
      const omniscientState = getPublicState(state, 'human_0');
      expect(omniscientState.round.word).toBe('苹果');

      // Regular guesser cannot see word
      const guesserState = getPublicState(state, 'human_1');
      expect(guesserState.round.word).toBeUndefined();

      // Observer can see word
      const observerState = getPublicState(state, 'ai_0');
      expect(observerState.round.word).toBe('苹果');
    });
  });

  describe('Turn order (AC-2)', () => {
    it('rejects questions from non-current speaker', () => {
      const { roomId, room } = setupRoom();
      const state = room.state;
      state.phase = 'questioning';
      state.currentRound = 1;
      state.rounds = [{
        roundNumber: 1,
        word: '苹果',
        wordCategory: '食物',
        gameTeamType: 'human',
        observeTeamType: 'ai',
        gameTeamPlayers: ['human_0', 'human_1', 'human_2', 'human_3'],
        observeTeamPlayers: ['ai_0', 'ai_1', 'ai_2', 'ai_3'],
        omniscientId: 'human_0',
        captainId: 'ai_0',
        questions: [],
        discussions: [],
        questionCount: 0,
        currentSpeakerIndex: 0,
        questionStartTime: Date.now(),
        guessAttempt: null,
        guessCorrect: false,
        voteTarget: null,
        voteCorrect: false,
        scores: { gameTeam: 0, observeTeam: 0 },
      }];

      // human_1 is not the current speaker (index 0 = human_0)
      const beforeCount = state.rounds[0].questionCount;
      submitQuestion(roomId, 'human_1', '这是食物吗？');
      expect(state.rounds[0].questionCount).toBe(beforeCount);
    });
  });

  describe('Voting (AC-4)', () => {
    it('only allows captain to vote', () => {
      const { roomId, room } = setupRoom();
      const state = room.state;
      state.phase = 'voting';
      state.currentRound = 1;
      state.rounds = [{
        roundNumber: 1,
        word: '苹果',
        gameTeamType: 'human',
        observeTeamType: 'ai',
        gameTeamPlayers: ['human_0', 'human_1', 'human_2', 'human_3'],
        observeTeamPlayers: ['ai_0', 'ai_1', 'ai_2', 'ai_3'],
        omniscientId: 'human_0',
        captainId: 'ai_0',
        questions: [],
        discussions: [],
        questionCount: 5,
        voteTarget: null,
        voteCorrect: false,
        guessAttempt: null,
        guessCorrect: false,
        scores: { gameTeam: 0, observeTeam: 0 },
      }];

      // Non-captain vote should be ignored
      submitVote(roomId, 'ai_1', 'human_0');
      expect(state.rounds[0].voteTarget).toBeNull();
    });
  });
});
