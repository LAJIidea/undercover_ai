import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// We test MobilePlayer and GameDisplay by rendering them with mocked dependencies

// Mock audio module
vi.mock('../utils/audio.js', () => ({
  createSTTHandler: vi.fn(async (onResult, onError) => ({
    isBrowserFallback: true,
    start: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    _triggerResult: (text) => onResult(text),
  })),
  playTTS: vi.fn(),
}));

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

import MobilePlayer from '../pages/MobilePlayer.jsx';
import GameDisplay from '../components/GameDisplay.jsx';
import { playTTS, createSTTHandler } from '../utils/audio.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

function renderMobilePlayer() {
  return render(
    <MemoryRouter initialEntries={['/play/TEST01']}>
      <Routes>
        <Route path="/play/:roomId" element={<MobilePlayer />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MobilePlayer component (AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWs.playerId = null;
    mockWs.gameState = null;
    mockWs.error = null;
    mockWs.messages = [];
    mockWs.send.mockReturnValue(true);
  });

  it('shows join page when not joined (playerId null)', () => {
    renderMobilePlayer();
    expect(screen.getByText('加入游戏')).toBeTruthy();
    expect(screen.getByText(/TEST01/)).toBeTruthy();
  });

  it('shows error message from server', () => {
    mockWs.error = 'Room is full';
    renderMobilePlayer();
    expect(screen.getByText('Room is full')).toBeTruthy();
  });

  it('shows game UI after joining', () => {
    mockWs.playerId = 'human_0';
    mockWs.gameState = {
      phase: 'discussion',
      currentRound: 1,
      totalRounds: 3,
      scores: { ai: 0, human: 0 },
      aiPlayers: [],
      humanPlayers: [],
      round: {
        roundNumber: 1,
        gameTeamType: 'human',
        observeTeamType: 'ai',
        gameTeamPlayers: ['human_0', 'human_1'],
        observeTeamPlayers: ['ai_0'],
        captainId: 'ai_0',
        questions: [],
        discussions: [],
        questionCount: 0,
        currentSpeakerIndex: 0,
        myRole: 'guesser',
      },
    };
    renderMobilePlayer();
    expect(screen.getByText(/讨论阶段/)).toBeTruthy();
  });

  it('voice recognition auto-sends discussion message', async () => {
    mockWs.playerId = 'human_0';
    mockWs.gameState = {
      phase: 'discussion',
      currentRound: 1,
      totalRounds: 3,
      scores: { ai: 0, human: 0 },
      aiPlayers: [],
      humanPlayers: [],
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
        myRole: 'guesser',
      },
    };
    renderMobilePlayer();

    // Wait for STT handler init
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    // Get the STT handler and trigger a recognition result
    const sttHandler = await createSTTHandler.mock.results[0]?.value;
    if (sttHandler?._triggerResult) {
      act(() => { sttHandler._triggerResult('我觉得是食物'); });

      // Should have auto-sent discussion message
      expect(mockWs.send).toHaveBeenCalledWith({
        type: 'discuss',
        message: '我觉得是食物',
      });
    }
  });

  it('preserves text when send fails', async () => {
    mockWs.playerId = 'human_0';
    mockWs.send.mockReturnValue(false); // Simulate failure
    mockWs.gameState = {
      phase: 'discussion',
      currentRound: 1,
      totalRounds: 3,
      scores: { ai: 0, human: 0 },
      aiPlayers: [],
      humanPlayers: [],
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
        myRole: 'guesser',
      },
    };
    renderMobilePlayer();

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const sttHandler = await createSTTHandler.mock.results[0]?.value;
    if (sttHandler?._triggerResult) {
      act(() => { sttHandler._triggerResult('不要丢失'); });

      // Send failed - should show failure message
      expect(screen.getByText(/发送失败/)).toBeTruthy();
    }
  });
});

describe('GameDisplay TTS (AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers playTTS for AI messages', () => {
    const ws = {
      gameState: {
        phase: 'questioning',
        currentRound: 1,
        totalRounds: 3,
        scores: { ai: 0, human: 0 },
        aiPlayers: [
          { id: 'ai_0', name: 'AI-Alpha', personality: 'analytical' },
        ],
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
      messages: [
        { playerId: 'ai_0', message: 'AI说话了', timestamp: 1 },
      ],
    };

    render(<GameDisplay roomId="TEST01" ws={ws} />);

    // playTTS should have been called for AI message
    expect(playTTS).toHaveBeenCalledWith('AI说话了');
  });

  it('does NOT trigger playTTS for human messages', () => {
    const ws = {
      gameState: {
        phase: 'questioning',
        currentRound: 1,
        totalRounds: 3,
        scores: { ai: 0, human: 0 },
        aiPlayers: [
          { id: 'ai_0', name: 'AI-Alpha', personality: 'analytical' },
        ],
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
      messages: [
        { playerId: 'human_0', message: '人类说话了', timestamp: 1 },
      ],
    };

    render(<GameDisplay roomId="TEST01" ws={ws} />);

    expect(playTTS).not.toHaveBeenCalled();
  });
});
