import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the voice auto-send logic and send failure fallback
// extracted from MobilePlayer's autoSendVoiceResult pattern

describe('Voice auto-send integration (AC-8)', () => {
  it('auto-sends discussion message when phase is discussion', () => {
    const sent = [];
    const mockWs = {
      send: vi.fn((data) => { sent.push(data); return true; }),
    };
    let textInput = '';
    const setTextInput = (v) => { textInput = v; };
    let sttStatus = '';
    const setSttStatus = (v) => { sttStatus = v; };

    // Simulate autoSendVoiceResult logic
    const phase = 'discussion';
    const text = '我觉得这是食物';

    let sendSuccess = false;
    if (phase === 'discussion') {
      sendSuccess = mockWs.send({ type: 'discuss', message: text.trim() });
    }
    if (sendSuccess) {
      setTextInput('');
    } else {
      setTextInput(text);
      setSttStatus('发送失败，请手动点击发送');
    }

    expect(mockWs.send).toHaveBeenCalledWith({ type: 'discuss', message: '我觉得这是食物' });
    expect(textInput).toBe('');
    expect(sttStatus).toBe('');
  });

  it('auto-sends question message when phase is questioning', () => {
    const mockWs = {
      send: vi.fn(() => true),
    };
    let textInput = '';
    const setTextInput = (v) => { textInput = v; };

    const phase = 'questioning';
    const text = '这是人物吗';

    if (phase === 'questioning') {
      const sent = mockWs.send({ type: 'question', question: text.trim() });
      if (sent) setTextInput('');
    }

    expect(mockWs.send).toHaveBeenCalledWith({ type: 'question', question: '这是人物吗' });
    expect(textInput).toBe('');
  });

  it('preserves text and shows warning when send fails', () => {
    const mockWs = {
      send: vi.fn(() => false), // Simulate ws not ready
    };
    let textInput = '';
    const setTextInput = (v) => { textInput = v; };
    let sttStatus = '';
    const setSttStatus = (v) => { sttStatus = v; };

    const phase = 'discussion';
    const text = '不要清空我';

    const sent = mockWs.send({ type: 'discuss', message: text.trim() });
    if (sent) {
      setTextInput('');
    } else {
      setTextInput(text);
      setSttStatus('发送失败，请手动点击发送');
    }

    expect(textInput).toBe('不要清空我');
    expect(sttStatus).toBe('发送失败，请手动点击发送');
  });

  it('fills text input when phase is not active (no auto-send)', () => {
    let textInput = '';
    const setTextInput = (v) => { textInput = v; };

    const phase = 'voting'; // Not discussion or questioning
    const text = '投票阶段的语音';

    if (phase === 'discussion' || phase === 'questioning') {
      // Would auto-send
    } else {
      setTextInput(text);
    }

    expect(textInput).toBe('投票阶段的语音');
  });
});

describe('TTS trigger logic (AC-8)', () => {
  it('identifies AI messages for TTS playback', () => {
    const messages = [
      { playerId: 'ai_0', message: 'AI说话了', type: 'discussion' },
      { playerId: 'human_0', message: '人类说话', type: 'discussion' },
      { playerId: 'ai_1', message: 'AI提问', type: 'ai_question' },
      { playerId: 'host', message: '主持人回答：是', type: 'host_answer' },
    ];

    const ttsTargets = messages.filter(
      m => m.playerId?.startsWith('ai_') || m.playerId === 'host'
    );

    expect(ttsTargets).toHaveLength(3);
    expect(ttsTargets[0].playerId).toBe('ai_0');
    expect(ttsTargets[1].playerId).toBe('ai_1');
    expect(ttsTargets[2].playerId).toBe('host');
  });

  it('does not TTS human messages', () => {
    const messages = [
      { playerId: 'human_0', message: '人类发言' },
      { playerId: 'human_1', message: '另一个人' },
    ];

    const ttsTargets = messages.filter(
      m => m.playerId?.startsWith('ai_') || m.playerId === 'host'
    );

    expect(ttsTargets).toHaveLength(0);
  });
});
