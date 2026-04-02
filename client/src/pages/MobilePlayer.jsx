import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket.js';

export default function MobilePlayer() {
  const { roomId } = useParams();
  const [playerName, setPlayerName] = useState('');
  const [joined, setJoined] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [textInput, setTextInput] = useState('');
  const recognitionRef = useRef(null);
  const ws = useWebSocket();

  const handleJoin = () => {
    if (!playerName.trim()) return;
    ws.send({ type: 'join_room', roomId, playerName: playerName.trim(), clientType: 'player' });
    setJoined(true);
  };

  const state = ws.gameState;
  const round = state?.round;
  const myRole = round?.myRole;
  const phase = state?.phase;

  // STT via browser Speech Recognition (fallback)
  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('浏览器不支持语音识别，请使用文字输入');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setTextInput(text);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopVoiceInput = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const sendMessage = () => {
    if (!textInput.trim()) return;
    if (phase === 'discussion') {
      ws.send({ type: 'discuss', message: textInput.trim() });
    } else if (phase === 'questioning') {
      ws.send({ type: 'question', question: textInput.trim() });
    }
    setTextInput('');
  };

  const sendGuess = () => {
    if (!textInput.trim()) return;
    ws.send({ type: 'guess', word: textInput.trim() });
    setTextInput('');
  };

  const sendVote = (targetId) => {
    ws.send({ type: 'vote', targetId });
  };

  if (!joined) {
    return (
      <div className="min-h-screen bg-game-bg flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-center mb-2">加入游戏</h1>
          <p className="text-center text-gray-400 mb-6">房间号：{roomId}</p>
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="输入你的名字"
            className="w-full bg-card-bg border border-card-border rounded-xl p-4 text-white text-center text-lg mb-4"
            maxLength={10}
          />
          <button
            onClick={handleJoin}
            disabled={!playerName.trim() || !ws.connected}
            className="w-full py-4 bg-primary hover:bg-primary-dark rounded-xl text-lg font-semibold
              transition-all disabled:opacity-50"
          >
            加入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-game-bg flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-sm text-gray-400">房间 {roomId}</span>
          <span className="text-sm text-gray-500 ml-2">第 {round?.roundNumber || '-'}/3 轮</span>
        </div>
        <RoleBadge role={myRole} />
      </div>

      {/* Word (only visible to omniscient/observers) */}
      {round?.word && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4 mb-4 text-center">
          <p className="text-xs text-gray-400 mb-1">
            {myRole === 'omniscient' ? '你是全知者！词语是：' : '当前词语：'}
          </p>
          <p className="text-accent text-2xl font-bold">{round.word}</p>
          {round.wordCategory && (
            <p className="text-xs text-gray-500 mt-1">类别：{round.wordCategory}</p>
          )}
        </div>
      )}

      {/* Phase info */}
      <div className="bg-card-bg rounded-xl p-3 mb-4 text-center">
        <PhaseInfo phase={phase} myRole={myRole} round={round} />
      </div>

      {/* Recent messages */}
      <div className="flex-1 bg-card-bg/50 rounded-xl p-3 mb-4 overflow-y-auto max-h-64">
        {(round?.questions || []).slice(-5).map((q, i) => (
          <div key={i} className="mb-2 text-sm">
            <span className="text-gray-400">{q.playerId}: </span>
            <span className="text-white">{q.question}</span>
            {q.answer && <span className="text-accent ml-2">→ {q.answer}</span>}
          </div>
        ))}
        {(round?.discussions || []).slice(-3).map((d, i) => (
          <div key={`d${i}`} className="mb-1 text-sm text-gray-400">
            {d.playerId}: {d.message}
          </div>
        ))}
      </div>

      {/* Voting UI */}
      {phase === 'voting' && myRole === 'captain' && (
        <div className="mb-4">
          <p className="text-sm text-center text-gray-400 mb-2">你是队长，请选择全知者：</p>
          <div className="grid grid-cols-2 gap-2">
            {round?.gameTeamPlayers?.map(pid => (
              <button
                key={pid}
                onClick={() => sendVote(pid)}
                className="py-3 bg-card-bg border border-card-border rounded-xl hover:border-accent transition-colors"
              >
                {pid}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      {(phase === 'discussion' || phase === 'questioning') &&
       (myRole === 'guesser' || myRole === 'omniscient') && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder={phase === 'discussion' ? '讨论...' : '提问（是非问题）...'}
              className="flex-1 bg-card-bg border border-card-border rounded-xl p-3 text-white"
            />
            <button
              onClick={sendMessage}
              className="px-4 bg-primary rounded-xl font-medium"
            >
              发送
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onTouchStart={startVoiceInput}
              onTouchEnd={stopVoiceInput}
              onMouseDown={startVoiceInput}
              onMouseUp={stopVoiceInput}
              className={`flex-1 py-4 rounded-xl font-medium text-lg transition-all
                ${isRecording
                  ? 'bg-red-600 text-white scale-95'
                  : 'bg-card-bg border border-card-border text-gray-300'}`}
            >
              {isRecording ? '松开发送' : '按住说话'}
            </button>

            {phase === 'questioning' && (
              <button
                onClick={sendGuess}
                className="px-6 py-4 bg-accent text-gray-900 rounded-xl font-bold"
              >
                猜词
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }) {
  const styles = {
    omniscient: 'bg-yellow-900/50 text-yellow-300',
    guesser: 'bg-green-900/50 text-green-300',
    observer: 'bg-blue-900/50 text-blue-300',
    captain: 'bg-purple-900/50 text-purple-300',
  };
  const labels = {
    omniscient: '全知者',
    guesser: '游戏队',
    observer: '观察者',
    captain: '队长',
  };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[role] || 'bg-gray-700 text-gray-300'}`}>
      {labels[role] || '等待分配'}
    </span>
  );
}

function PhaseInfo({ phase, myRole, round }) {
  const messages = {
    waiting: '等待游戏开始...',
    configuring: '主持人正在配置游戏...',
    round_start: '回合即将开始！',
    word_assignment: '正在分配词语...',
    discussion: '讨论阶段 - 与队友交流想法',
    questioning: myRole === 'guesser' || myRole === 'omniscient'
      ? '轮到你提问了！提出一个是非问题'
      : '观察提问中...',
    guessing: '有人正在猜词...',
    voting: myRole === 'captain' ? '请选出你认为的全知者！' : '等待队长投票...',
    round_result: '回合结算中...',
    game_over: '游戏结束！',
  };
  return <p className="text-sm text-gray-300">{messages[phase] || phase}</p>;
}
