import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, BrowserRouter } from 'react-router-dom';

// Mock audio module
vi.mock('../utils/audio.js', () => {
  let capturedOnResult = null;
  return {
    createSTTHandler: vi.fn(async (onResult, onError) => {
      capturedOnResult = onResult;
      return {
        isBrowserFallback: true,
        start: vi.fn(),
        stop: vi.fn(),
        close: vi.fn(),
      };
    }),
    playTTS: vi.fn(),
    // Expose helper to trigger STT result from tests
    _triggerSTTResult: (text) => { if (capturedOnResult) capturedOnResult(text); },
    _resetCapture: () => { capturedOnResult = null; },
  };
});

// Mock useWebSocket hook
const mockWs = {
  connected: true,
  clientId: 'test-client',
  gameState: null,
  playerId: null,
  messages: [],
  error: null,
  send: vi.fn(() => true),
  on: vi.fn(),
  setGameState: vi.fn(),
  clearError: vi.fn(),
};

vi.mock('../hooks/useWebSocket.js', () => ({
  useWebSocket: vi.fn(() => mockWs),
}));

import App from '../App.jsx';
import MobilePlayer from '../pages/MobilePlayer.jsx';
import GameDisplay from '../components/GameDisplay.jsx';
import { playTTS, createSTTHandler, _triggerSTTResult, _resetCapture } from '../utils/audio.js';

function makeGameState(phase, myRole = 'guesser') {
  return {
    phase,
    currentRound: 1,
    totalRounds: 3,
    scores: { ai: 0, human: 0 },
    aiPlayers: [{ id: 'ai_0', name: 'AI-Alpha', personality: 'analytical' }],
    humanPlayers: [{ id: 'human_0', name: 'P0', connected: true }],
    round: {
      roundNumber: 1,
      gameTeamType: 'human',
      observeTeamType: 'ai',
      gameTeamPlayers: ['human_0'],
      observeTeamPlayers: ['ai_0'],
      captainId: 'ai_0',
      questions: [],
      discussions: [],
      questionCount: 0,
      currentSpeakerIndex: 0,
      questionStartTime: Date.now(),
      discussionStartTime: Date.now() - 5000,
      myRole,
    },
  };
}

function renderMobilePlayer() {
  return render(
    <MemoryRouter initialEntries={['/play/TEST01']}>
      <Routes>
        <Route path="/play/:roomId" element={<MobilePlayer />} />
      </Routes>
    </MemoryRouter>
  );
}

// ============================================================
// App → Lobby first-screen regression (AC-7/AC-8)
// ============================================================
describe('App → Lobby first-screen (AC-7/AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCapture();
    mockWs.playerId = null;
    mockWs.gameState = null;
    mockWs.error = null;
    mockWs.messages = [];
    mockWs.send.mockReturnValue(true);
  });

  it('shows create room button initially', () => {
    render(<BrowserRouter><App /></BrowserRouter>);
    expect(screen.getByText('创建游戏房间')).toBeTruthy();
  });

  it('enters Lobby immediately after room_created with state', () => {
    // Capture the on() callback for room_created
    let roomCreatedCallback = null;
    mockWs.on.mockImplementation((type, cb) => {
      if (type === 'room_created') roomCreatedCallback = cb;
    });

    render(<BrowserRouter><App /></BrowserRouter>);

    // Click create room
    act(() => { fireEvent.click(screen.getByText('创建游戏房间')); });

    // Simulate server response with state
    expect(roomCreatedCallback).toBeTruthy();
    mockWs.gameState = { phase: 'waiting', roomId: 'ABC123', currentRound: 0, totalRounds: 3, scores: { ai: 0, human: 0 }, aiPlayers: [], humanPlayers: [] };
    act(() => {
      roomCreatedCallback({ roomId: 'ABC123', state: mockWs.gameState });
    });

    // Should show Lobby with room ID, not LoadingScreen
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('游戏大厅')).toBeTruthy();
    expect(screen.queryByText('加载游戏中...')).toBeNull();
  });
});

// ============================================================
// MobilePlayer component (AC-8)
// ============================================================
describe('MobilePlayer component (AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCapture();
    mockWs.playerId = null;
    mockWs.gameState = null;
    mockWs.error = null;
    mockWs.messages = [];
    mockWs.send.mockReturnValue(true);
  });

  it('shows join page when not joined', () => {
    renderMobilePlayer();
    expect(screen.getByText('加入游戏')).toBeTruthy();
    expect(screen.getByText(/TEST01/)).toBeTruthy();
  });

  it('shows error message from server', () => {
    mockWs.error = 'Room is full';
    renderMobilePlayer();
    expect(screen.getByText('Room is full')).toBeTruthy();
  });

  it('shows game UI after joining in discussion phase', () => {
    mockWs.playerId = 'human_0';
    mockWs.gameState = makeGameState('discussion');
    renderMobilePlayer();
    expect(screen.getByText(/讨论阶段/)).toBeTruthy();
  });

  it('voice auto-sends discussion message (no conditional)', async () => {
    mockWs.playerId = 'human_0';
    mockWs.gameState = makeGameState('discussion');
    renderMobilePlayer();

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // createSTTHandler MUST have been called
    expect(createSTTHandler).toHaveBeenCalledTimes(1);

    // Trigger recognition result directly via captured callback
    act(() => { _triggerSTTResult('我觉得是食物'); });

    expect(mockWs.send).toHaveBeenCalledWith({
      type: 'discuss',
      message: '我觉得是食物',
    });
  });

  it('voice auto-sends question message in questioning phase', async () => {
    mockWs.playerId = 'human_0';
    mockWs.gameState = makeGameState('questioning');
    renderMobilePlayer();

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(createSTTHandler).toHaveBeenCalledTimes(1);

    act(() => { _triggerSTTResult('这是食物吗'); });

    expect(mockWs.send).toHaveBeenCalledWith({
      type: 'question',
      question: '这是食物吗',
    });
  });

  it('preserves text AND shows warning when send fails', async () => {
    mockWs.playerId = 'human_0';
    mockWs.send.mockReturnValue(false);
    mockWs.gameState = makeGameState('discussion');
    renderMobilePlayer();

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(createSTTHandler).toHaveBeenCalledTimes(1);

    act(() => { _triggerSTTResult('不要丢失'); });

    // Should show failure warning
    expect(screen.getByText(/发送失败/)).toBeTruthy();
    // Input should still contain the text
    const input = screen.getByPlaceholderText('讨论...');
    expect(input.value).toBe('不要丢失');
  });
});

// ============================================================
// GameDisplay TTS (AC-8) — covers 4 message types
// ============================================================
describe('GameDisplay TTS (AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDisplayWs(messages) {
    return {
      gameState: {
        phase: 'questioning',
        currentRound: 1,
        totalRounds: 3,
        scores: { ai: 0, human: 0 },
        aiPlayers: [{ id: 'ai_0', name: 'AI-Alpha', personality: 'analytical' }],
        humanPlayers: [{ id: 'human_0', name: 'P0', connected: true }],
        round: {
          roundNumber: 1,
          gameTeamType: 'ai',
          observeTeamType: 'human',
          gameTeamPlayers: ['ai_0'],
          observeTeamPlayers: ['human_0'],
          captainId: 'human_0',
          questions: [],
          discussions: [],
          questionCount: 0,
          currentSpeakerIndex: 0,
          questionStartTime: Date.now(),
          discussionStartTime: Date.now() - 50000,
        },
      },
      messages,
    };
  }

  it('triggers playTTS for AI discussion message', () => {
    const ws = makeDisplayWs([
      { playerId: 'ai_0', message: 'AI讨论内容', type: 'discussion', timestamp: 1 },
    ]);
    render(<GameDisplay roomId="TEST01" ws={ws} />);
    expect(playTTS).toHaveBeenCalledWith('AI讨论内容');
  });

  it('triggers playTTS for AI question message', () => {
    const ws = makeDisplayWs([
      { playerId: 'ai_0', message: '这是人物吗', type: 'ai_question', timestamp: 2 },
    ]);
    render(<GameDisplay roomId="TEST01" ws={ws} />);
    expect(playTTS).toHaveBeenCalledWith('这是人物吗');
  });

  it('triggers playTTS for host answer message', () => {
    const ws = makeDisplayWs([
      { playerId: 'host', message: '主持人回答：是', type: 'host_answer', timestamp: 3 },
    ]);
    render(<GameDisplay roomId="TEST01" ws={ws} />);
    expect(playTTS).toHaveBeenCalledWith('主持人回答：是');
  });

  it('does NOT trigger playTTS for human messages', () => {
    const ws = makeDisplayWs([
      { playerId: 'human_0', message: '人类说话了', type: 'discussion', timestamp: 4 },
    ]);
    render(<GameDisplay roomId="TEST01" ws={ws} />);
    expect(playTTS).not.toHaveBeenCalled();
  });
});
