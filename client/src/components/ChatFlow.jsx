import { useRef, useEffect } from 'react';

export default function ChatFlow({
  questions, discussions, messages, aiPlayers, humanPlayers, phase,
  guessAttempt, guessCorrect, word,
}) {
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [questions, discussions, messages]);

  const allPlayers = [...(aiPlayers || []), ...(humanPlayers || [])];
  const getPlayerName = (id) => allPlayers.find(p => p.id === id)?.name || id;
  const isAI = (id) => id?.startsWith('ai_');

  // Merge and sort all messages by timestamp
  const allMessages = [
    ...discussions.map(d => ({ ...d, msgType: 'discussion' })),
    ...questions.map(q => ({ ...q, msgType: 'question', playerId: q.playerId })),
  ].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  return (
    <div
      ref={scrollRef}
      className="bg-card-bg/50 border border-card-border rounded-xl p-4 overflow-y-auto h-full"
    >
      {allMessages.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          {phase === 'word_assignment' ? '正在分配词语...'
            : phase === 'discussion' ? '讨论阶段 - 等待发言...'
            : '等待游戏开始...'}
        </div>
      )}

      {allMessages.map((msg, i) => (
        <div key={i} className="mb-3 animate-slide-in">
          {msg.msgType === 'discussion' ? (
            <div className="flex gap-2">
              <span className={`text-sm font-medium shrink-0
                ${isAI(msg.playerId) ? 'text-red-400' : 'text-blue-400'}`}>
                {getPlayerName(msg.playerId)}:
              </span>
              <span className="text-gray-300 text-sm">{msg.message}</span>
            </div>
          ) : (
            <div className="bg-game-bg rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className={`text-sm font-medium shrink-0
                  ${isAI(msg.playerId) ? 'text-red-400' : 'text-blue-400'}`}>
                  {getPlayerName(msg.playerId)}
                </span>
                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">提问</span>
              </div>
              <p className="text-white mt-1">{msg.question}</p>
              {msg.answer && (
                <p className="mt-1 text-accent font-bold text-lg">
                  主持人：{msg.answer}
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Guess attempt */}
      {guessAttempt && (
        <div className="mt-3 p-3 bg-accent/10 border border-accent/30 rounded-lg animate-slide-in">
          <p className="text-accent font-medium">
            猜测：{guessAttempt}
            {phase === 'round_result' && (
              <span className={`ml-2 ${guessCorrect ? 'text-green-400' : 'text-red-400'}`}>
                {guessCorrect ? '正确！' : '错误'}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Word reveal */}
      {phase === 'round_result' && word && (
        <div className="mt-3 p-4 bg-primary/10 border border-primary/30 rounded-lg text-center animate-slide-in">
          <p className="text-gray-400 text-sm">本轮词语</p>
          <p className="text-primary text-2xl font-bold">{word}</p>
        </div>
      )}
    </div>
  );
}
