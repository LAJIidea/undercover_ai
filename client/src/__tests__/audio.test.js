import { describe, it, expect, vi } from 'vitest';

describe('Audio STT Handler', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clean up globals
    delete global.SpeechRecognition;
    delete global.webkitSpeechRecognition;
  });

  function mockSpeechRecognition() {
    const instance = {
      lang: '', continuous: false, interimResults: false,
      onresult: null, onerror: null,
      start: vi.fn(), stop: vi.fn(), abort: vi.fn(),
    };
    // Must be a real constructor function
    function MockSR() { return Object.assign(this, instance); }
    global.SpeechRecognition = MockSR;
    return instance;
  }

  it('createSTTHandler falls back to browser when no FunASR config', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ available: false, url: '', key: '' }),
    });
    const mockRec = mockSpeechRecognition();

    const { createSTTHandler } = await import('../utils/audio.js');
    const onResult = vi.fn();
    const handler = await createSTTHandler(onResult);

    expect(handler.isBrowserFallback).toBe(true);
  });

  it('createSTTHandler tries FunASR then falls back on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ available: true, url: 'wss://fake.example.com/ws', key: 'k' }),
    });

    // Mock WebSocket that fails
    const origWS = global.WebSocket;
    function FailingWS() {
      this.readyState = 0;
      this.binaryType = '';
      this.send = vi.fn();
      this.close = vi.fn();
      setTimeout(() => this.onerror?.(new Error('fail')), 10);
    }
    global.WebSocket = FailingWS;

    const mockRec = mockSpeechRecognition();

    const { createSTTHandler } = await import('../utils/audio.js');
    const handler = await createSTTHandler(vi.fn(), vi.fn());

    expect(handler.isBrowserFallback).toBe(true);
    global.WebSocket = origWS;
  });

  it('BrowserSTTHandler start/stop/multi-turn work', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ available: false }),
    });
    const mockRec = mockSpeechRecognition();

    const { createSTTHandler } = await import('../utils/audio.js');
    const onResult = vi.fn();
    const handler = await createSTTHandler(onResult);

    expect(handler.isBrowserFallback).toBe(true);

    // First turn
    await handler.start();
    expect(mockRec.start).toHaveBeenCalledTimes(1);
    handler.stop();
    expect(mockRec.stop).toHaveBeenCalledTimes(1);

    // Second turn (multi-turn)
    await handler.start();
    expect(mockRec.start).toHaveBeenCalledTimes(2);
    handler.stop();
    expect(mockRec.stop).toHaveBeenCalledTimes(2);
  });
});
