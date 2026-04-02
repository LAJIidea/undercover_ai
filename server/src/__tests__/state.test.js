import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GamePhase, canTransition, createInitialGameState, createRoundState,
  TOTAL_ROUNDS, QUESTION_TIME_LIMIT_MS,
} from '../game/state.js';

describe('Game State', () => {
  it('creates initial game state with correct defaults', () => {
    const state = createInitialGameState('TEST01');
    expect(state.roomId).toBe('TEST01');
    expect(state.phase).toBe(GamePhase.WAITING);
    expect(state.currentRound).toBe(0);
    expect(state.totalRounds).toBe(TOTAL_ROUNDS);
    expect(state.scores).toEqual({ ai: 0, human: 0 });
    expect(state.aiConfig.players).toHaveLength(4);
    expect(state.humanPlayers).toEqual([]);
  });

  it('has 7-minute question time limit', () => {
    expect(QUESTION_TIME_LIMIT_MS).toBe(7 * 60 * 1000);
  });

  it('supports 3 total rounds', () => {
    expect(TOTAL_ROUNDS).toBe(3);
  });

  describe('phase transitions', () => {
    it('allows valid transitions', () => {
      expect(canTransition(GamePhase.WAITING, GamePhase.CONFIGURING)).toBe(true);
      expect(canTransition(GamePhase.CONFIGURING, GamePhase.ROUND_START)).toBe(true);
      expect(canTransition(GamePhase.ROUND_START, GamePhase.WORD_ASSIGNMENT)).toBe(true);
      expect(canTransition(GamePhase.WORD_ASSIGNMENT, GamePhase.DISCUSSION)).toBe(true);
      expect(canTransition(GamePhase.DISCUSSION, GamePhase.QUESTIONING)).toBe(true);
      expect(canTransition(GamePhase.QUESTIONING, GamePhase.GUESSING)).toBe(true);
      expect(canTransition(GamePhase.QUESTIONING, GamePhase.VOTING)).toBe(true);
      expect(canTransition(GamePhase.GUESSING, GamePhase.VOTING)).toBe(true);
      expect(canTransition(GamePhase.VOTING, GamePhase.ROUND_RESULT)).toBe(true);
      expect(canTransition(GamePhase.ROUND_RESULT, GamePhase.ROUND_START)).toBe(true);
      expect(canTransition(GamePhase.ROUND_RESULT, GamePhase.GAME_OVER)).toBe(true);
    });

    it('rejects invalid transitions', () => {
      expect(canTransition(GamePhase.WAITING, GamePhase.QUESTIONING)).toBe(false);
      expect(canTransition(GamePhase.GAME_OVER, GamePhase.ROUND_START)).toBe(false);
      expect(canTransition(GamePhase.DISCUSSION, GamePhase.VOTING)).toBe(false);
    });

    it('does not allow any transition from GAME_OVER', () => {
      for (const phase of Object.values(GamePhase)) {
        expect(canTransition(GamePhase.GAME_OVER, phase)).toBe(false);
      }
    });
  });

  describe('round state creation', () => {
    it('alternates team roles correctly', () => {
      const state = createInitialGameState('TEST');
      state.aiConfig.players = [
        { id: 'ai_0' }, { id: 'ai_1' }, { id: 'ai_2' }, { id: 'ai_3' },
      ];
      state.humanPlayers = [
        { id: 'h_0' }, { id: 'h_1' }, { id: 'h_2' }, { id: 'h_3' },
      ];

      // Round 1: AI is game team
      const r1 = createRoundState(1, state);
      expect(r1.gameTeamType).toBe('ai');
      expect(r1.observeTeamType).toBe('human');

      // Round 2: Human is game team
      const r2 = createRoundState(2, state);
      expect(r2.gameTeamType).toBe('human');
      expect(r2.observeTeamType).toBe('ai');

      // Round 3: AI is game team again
      const r3 = createRoundState(3, state);
      expect(r3.gameTeamType).toBe('ai');
      expect(r3.observeTeamType).toBe('human');
    });

    it('assigns exactly one omniscient in game team', () => {
      const state = createInitialGameState('TEST');
      state.aiConfig.players = [
        { id: 'ai_0' }, { id: 'ai_1' }, { id: 'ai_2' }, { id: 'ai_3' },
      ];
      state.humanPlayers = [
        { id: 'h_0' }, { id: 'h_1' }, { id: 'h_2' }, { id: 'h_3' },
      ];

      const round = createRoundState(1, state);
      expect(round.gameTeamPlayers).toContain(round.omniscientId);
      expect(round.observeTeamPlayers).not.toContain(round.omniscientId);
    });

    it('assigns a captain in observe team', () => {
      const state = createInitialGameState('TEST');
      state.aiConfig.players = [
        { id: 'ai_0' }, { id: 'ai_1' }, { id: 'ai_2' }, { id: 'ai_3' },
      ];
      state.humanPlayers = [
        { id: 'h_0' }, { id: 'h_1' }, { id: 'h_2' }, { id: 'h_3' },
      ];

      const round = createRoundState(1, state);
      expect(round.observeTeamPlayers).toContain(round.captainId);
    });
  });
});
