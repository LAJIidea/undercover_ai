import { useState, useEffect, useRef } from 'react';
import PlayerCard from './PlayerCard.jsx';
import ChatFlow from './ChatFlow.jsx';
import Timer from './Timer.jsx';
import { playTTS } from '../utils/audio.js';

const PHASE_LABELS = {
  round_start: '回合开始',
  word_assignment: '分配词语',
  discussion: '讨论阶段',
  questioning: '提问阶段',
  guessing: '猜词阶段',
  voting: '投票阶段',
  round_result: '回合结算',
  game_over: '游戏结束',
};

export default function GameDisplay({ roomId, ws, onNewGame }) {
  const state = ws.gameState;
  const round = state?.round;
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const lastTtsIdRef = useRef(0);
  const ttsQueueRef = useRef(Promise.resolve());

  // Auto-play TTS for ALL AI messages (discussions + questions + host answers)
  useEffect(() => {
    if (!ws.messages.length) return;
    const newMessages = ws.messages.slice(lastTtsIdRef.current);
    // Always advance cursor, even when muted, to avoid replay on unmute
    lastTtsIdRef.current = ws.messages.length;

    if (!ttsEnabled) return;

    for (const msg of newMessages) {
      if (msg.playerId?.startsWith('ai_') || msg.playerId === 'host') {
        // Queue TTS sequentially to prevent overlapping audio
        ttsQueueRef.current = ttsQueueRef.current.then(
          () => playTTS(msg.message, roomId)
        ).catch(() => {});
      }
    }
  }, [ws.messages, ttsEnabled]);

  if (!state || !round) return <LoadingScreen />;

  const aiPlayers = state.aiPlayers || [];
  const humanPlayers = state.humanPlayers || [];
  const isAiGameTeam = round.gameTeamType === 'ai';

  return (
    <div className="min-h-screen bg-game-bg flex flex-col relative">
      {/* Top: AI Team */}
      <div className="p-4">
        <TeamHeader
          label={isAiGameTeam ? '游戏队 (AI)' : '观察队 (AI)'}
          color={isAiGameTeam ? 'text-red-400' : 'text-blue-400'}
        />
        <div className="grid grid-cols-4 gap-3 max-w-4xl mx-auto">
          {aiPlayers.map(p => (
            <PlayerCard
              key={p.id}
              player={p}
              isAI={true}
              isSpeaking={round.gameTeamPlayers?.[round.currentSpeakerIndex] === p.id}
              isOmniscient={state.phase === 'round_result' && round.omniscientId === p.id}
              isCaptain={round.captainId === p.id}
              isVoteTarget={state.phase === 'round_result' && round.voteTarget === p.id}
            />
          ))}
        </div>
      </div>

      {/* Middle: Host + Status + Chat + Timer + Score */}
      <div className="flex-1 flex flex-col px-4 min-h-0">
        {/* Status bar with Host */}
        <div className="flex items-center justify-between max-w-4xl mx-auto w-full mb-2">
          <div className="flex items-center gap-4">
            {/* Host avatar */}
            <div className="flex items-center gap-2 bg-card-bg rounded-xl px-3 py-1.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-sm font-bold">
                MC
              </div>
              <div>
                <p className="text-xs text-gray-400 leading-none">AI主持人</p>
                <p className="text-xs text-accent leading-none mt-0.5">
                  {state.phase === 'questioning' ? '等待提问...' :
                   state.phase === 'discussion' ? '讨论中' :
                   state.phase === 'voting' ? '等待投票' :
                   PHASE_LABELS[state.phase] || ''}
                </p>
              </div>
            </div>

            <span className="bg-primary/20 text-primary px-3 py-1 rounded-full text-sm font-medium">
              第 {round.roundNumber}/3 轮
            </span>
            <span className="bg-card-bg px-3 py-1 rounded-full text-sm">
              {PHASE_LABELS[state.phase] || state.phase}
            </span>
          </div>

          <div className="flex items-center gap-6">
            {/* Timer */}
            {(state.phase === 'questioning' || state.phase === 'discussion') && (
              <Timer
                startTime={state.phase === 'questioning'
                  ? round.questionStartTime
                  : round.discussionStartTime || null}
                duration={state.phase === 'questioning' ? 7 * 60 * 1000 : 45 * 1000}
              />
            )}

            {/* Score */}
            <div className="flex items-center gap-3 bg-card-bg rounded-xl px-4 py-2">
              <div className="text-center">
                <p className="text-xs text-gray-500 leading-none">AI</p>
                <p className="text-red-400 font-bold text-lg">{state.scores?.ai || 0}</p>
              </div>
              <span className="text-gray-600 text-xl">:</span>
              <div className="text-center">
                <p className="text-xs text-gray-500 leading-none">真人</p>
                <p className="text-blue-400 font-bold text-lg">{state.scores?.human || 0}</p>
              </div>
            </div>

            {/* TTS toggle */}
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`text-sm px-2 py-1 rounded ${ttsEnabled ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-400'}`}
            >
              {ttsEnabled ? '语音开' : '语音关'}
            </button>
          </div>
        </div>

        {/* Chat flow */}
        <div className="flex-1 max-w-4xl mx-auto w-full min-h-0">
          <ChatFlow
            questions={round.questions || []}
            discussions={round.discussions || []}
            messages={ws.messages}
            aiPlayers={aiPlayers}
            humanPlayers={humanPlayers}
            phase={state.phase}
            guessAttempt={round.guessAttempt}
            guessCorrect={round.guessCorrect}
            word={round.word}
          />
        </div>

        {/* Round result overlay */}
        {state.phase === 'round_result' && (
          <RoundResult round={round} scores={state.scores} />
        )}

        {/* Game over overlay */}
        {state.phase === 'game_over' && (
          <GameOver scores={state.scores} onNewGame={onNewGame} />
        )}
      </div>

      {/* Bottom: Human Team */}
      <div className="p-4">
        <div className="grid grid-cols-4 gap-3 max-w-4xl mx-auto">
          {humanPlayers.map(p => (
            <PlayerCard
              key={p.id}
              player={p}
              isAI={false}
              isSpeaking={round.gameTeamPlayers?.[round.currentSpeakerIndex] === p.id}
              isOmniscient={state.phase === 'round_result' && round.omniscientId === p.id}
              isCaptain={round.captainId === p.id}
              isVoteTarget={state.phase === 'round_result' && round.voteTarget === p.id}
            />
          ))}
        </div>
        <TeamHeader
          label={!isAiGameTeam ? '游戏队 (真人)' : '观察队 (真人)'}
          color={!isAiGameTeam ? 'text-red-400' : 'text-blue-400'}
          bottom
        />
      </div>
    </div>
  );
}

function TeamHeader({ label, color, bottom }) {
  return (
    <div className={`text-center ${bottom ? 'mt-2' : 'mb-2'}`}>
      <span className={`${color} font-semibold text-sm`}>{label}</span>
    </div>
  );
}

function RoundResult({ round, scores }) {
  return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
      <div className="bg-card-bg border border-card-border rounded-2xl p-8 text-center animate-slide-in max-w-md">
        <h2 className="text-2xl font-bold mb-4">回合结算</h2>
        {round.word && (
          <p className="text-accent text-xl mb-3">词语：{round.word}</p>
        )}
        {round.omniscientId && (
          <p className="text-gray-300 mb-2">全知者：{round.omniscientId}</p>
        )}
        <div className="flex justify-center gap-8 mt-4">
          <div>
            <p className="text-gray-400 text-sm">AI队</p>
            <p className="text-red-400 text-3xl font-bold">{scores?.ai || 0}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">真人队</p>
            <p className="text-blue-400 text-3xl font-bold">{scores?.human || 0}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameOver({ scores, onNewGame }) {
  const aiWins = (scores?.ai || 0) > (scores?.human || 0);
  const tie = (scores?.ai || 0) === (scores?.human || 0);
  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
      <div className="bg-card-bg border border-accent rounded-2xl p-10 text-center animate-slide-in">
        <h2 className="text-4xl font-bold mb-2">游戏结束</h2>
        <p className="text-2xl mb-6">
          {tie ? (
            <span className="text-accent">平局！</span>
          ) : aiWins ? (
            <span className="text-red-400">AI队 获胜！</span>
          ) : (
            <span className="text-blue-400">真人队 获胜！</span>
          )}
        </p>
        <div className="flex justify-center gap-12">
          <div>
            <p className="text-gray-400">AI队</p>
            <p className="text-red-400 text-5xl font-bold">{scores?.ai || 0}</p>
          </div>
          <div>
            <p className="text-gray-400">真人队</p>
            <p className="text-blue-400 text-5xl font-bold">{scores?.human || 0}</p>
          </div>
        </div>
        {onNewGame && (
          <button
            onClick={onNewGame}
            className="mt-6 px-8 py-3 bg-primary hover:bg-primary-dark rounded-xl font-semibold transition-all"
          >
            新游戏
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-game-bg flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">加载游戏中...</p>
      </div>
    </div>
  );
}
