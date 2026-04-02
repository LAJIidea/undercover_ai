import { describe, it, expect, afterAll } from 'vitest';
import { isValidModel, validateApiKey, getAllModels, MODEL_PROVIDERS } from '../ai/openrouter.js';

describe('OpenRouter API', () => {
  describe('Model validation', () => {
    it('supports 6 model providers', () => {
      const providers = Object.keys(MODEL_PROVIDERS);
      expect(providers).toContain('chatgpt');
      expect(providers).toContain('claude');
      expect(providers).toContain('gemini');
      expect(providers).toContain('deepseek');
      expect(providers).toContain('qwen');
      expect(providers).toContain('kimi');
      expect(providers).toHaveLength(6);
    });

    it('each provider has at least one model', () => {
      for (const [key, provider] of Object.entries(MODEL_PROVIDERS)) {
        expect(provider.models.length).toBeGreaterThanOrEqual(1);
        expect(provider.name).toBeTruthy();
      }
    });

    it('validates known model IDs', () => {
      expect(isValidModel('openai/gpt-4o')).toBe(true);
      expect(isValidModel('anthropic/claude-sonnet-4')).toBe(true);
      expect(isValidModel('google/gemini-2.5-flash-preview')).toBe(true);
      expect(isValidModel('deepseek/deepseek-chat-v3-0324')).toBe(true);
      expect(isValidModel('qwen/qwen-2.5-72b-instruct')).toBe(true);
      expect(isValidModel('moonshotai/moonshot-v1-8k')).toBe(true);
    });

    it('rejects invalid model IDs', () => {
      expect(isValidModel('fake/model')).toBe(false);
      expect(isValidModel('')).toBe(false);
      expect(isValidModel('gpt-4')).toBe(false);
    });

    it('getAllModels returns flat list with provider info', () => {
      const models = getAllModels();
      expect(models.length).toBeGreaterThanOrEqual(12);
      for (const m of models) {
        expect(m.id).toBeTruthy();
        expect(m.provider).toBeTruthy();
        expect(m.providerName).toBeTruthy();
        expect(m.label).toBeTruthy();
      }
    });
  });

  describe('API key validation', () => {
    const originalEnv = process.env.OPENROUTER_API_KEY;

    it('returns error when API key is missing', () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(validateApiKey()).toContain('not configured');
    });

    it('returns error when API key is placeholder', () => {
      process.env.OPENROUTER_API_KEY = 'your_openrouter_api_key_here';
      expect(validateApiKey()).toContain('not configured');
    });

    it('returns error when API key has wrong prefix', () => {
      process.env.OPENROUTER_API_KEY = 'definitely-not-a-real-openrouter-key';
      expect(validateApiKey()).toContain('format is invalid');
    });

    it('returns error when API key is too short', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-short';
      expect(validateApiKey()).toContain('format is invalid');
    });

    it('returns null when API key has correct format', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-v1-abcdef1234567890abcdef';
      expect(validateApiKey()).toBeNull();
    });

    // Restore
    afterAll(() => {
      if (originalEnv) process.env.OPENROUTER_API_KEY = originalEnv;
      else delete process.env.OPENROUTER_API_KEY;
    });
  });
});
