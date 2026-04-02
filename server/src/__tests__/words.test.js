import { describe, it, expect } from 'vitest';
import { selectWord, getWordCount, hasAvailableWords } from '../game/words.js';

describe('Word System (AC-9)', () => {
  it('has at least 60 preset words', () => {
    expect(getWordCount()).toBeGreaterThanOrEqual(60);
  });

  it('selects a word from preset database', async () => {
    const result = await selectWord({ mode: 'preset' });
    expect(result.word).toBeTruthy();
    expect(result.category).toBeTruthy();
    expect(['人物', '食物', '用品']).toContain(result.category);
  });

  it('hasAvailableWords returns true for preset mode', () => {
    expect(hasAvailableWords({ mode: 'preset' })).toBe(true);
  });

  it('hasAvailableWords returns true for ai mode', () => {
    expect(hasAvailableWords({ mode: 'ai' })).toBe(true);
  });

  it('hasAvailableWords returns true for mixed mode', () => {
    expect(hasAvailableWords({ mode: 'mixed', aiRatio: 0.5 })).toBe(true);
  });
});
