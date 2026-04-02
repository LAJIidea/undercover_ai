import { useState, useEffect } from 'react';

export default function ConfigPanel({ ws }) {
  const [models, setModels] = useState([]);
  const [aiConfig, setAiConfig] = useState([
    { model: '', personality: 'analytical' },
    { model: '', personality: 'cautious' },
    { model: '', personality: 'intuitive' },
    { model: '', personality: 'aggressive' },
  ]);
  const [hostModel, setHostModel] = useState('');
  const [wordMode, setWordMode] = useState('preset');
  const [aiRatio, setAiRatio] = useState(0.3);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(setModels).catch(() => {});
  }, []);

  // Listen for config errors
  useEffect(() => {
    if (ws.error) setSaveError(ws.error);
  }, [ws.error]);

  const personalities = [
    { value: 'analytical', label: '分析型' },
    { value: 'cautious', label: '谨慎型' },
    { value: 'intuitive', label: '直觉型' },
    { value: 'aggressive', label: '积极型' },
  ];

  const handleSave = () => {
    setSaveError(null);
    ws.clearError();
    ws.send({
      type: 'configure',
      config: {
        aiPlayers: aiConfig,
        hostModel,
        wordConfig: { mode: wordMode, aiRatio },
      },
    });
  };

  const updateAi = (index, field, value) => {
    setAiConfig(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const aiNames = ['AI-Alpha', 'AI-Beta', 'AI-Gamma', 'AI-Delta'];

  return (
    <div className="bg-card-bg border border-card-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">AI 配置</h2>

      {saveError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-2 mb-3">
          <p className="text-red-400 text-sm">{saveError}</p>
        </div>
      )}

      {/* Host model */}
      <div className="mb-4">
        <label className="text-sm text-gray-400 mb-1 block">主持人模型</label>
        <select
          value={hostModel}
          onChange={e => setHostModel(e.target.value)}
          className="w-full bg-game-bg border border-card-border rounded-lg p-2 text-white"
        >
          <option value="">选择模型...</option>
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.providerName} - {m.label}</option>
          ))}
        </select>
      </div>

      {/* AI players */}
      <div className="space-y-3">
        {aiConfig.map((ai, i) => (
          <div key={i} className="bg-game-bg rounded-lg p-3">
            <p className="text-sm font-medium mb-2">{aiNames[i]}</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={ai.model}
                onChange={e => updateAi(i, 'model', e.target.value)}
                className="bg-card-bg border border-card-border rounded p-1.5 text-sm text-white"
              >
                <option value="">模型...</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.providerName} - {m.label}</option>
                ))}
              </select>
              <select
                value={ai.personality}
                onChange={e => updateAi(i, 'personality', e.target.value)}
                className="bg-card-bg border border-card-border rounded p-1.5 text-sm text-white"
              >
                {personalities.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* Word source config */}
      <div className="mt-4 pt-4 border-t border-card-border">
        <h3 className="text-sm font-semibold mb-2 text-gray-300">词语来源</h3>
        <select
          value={wordMode}
          onChange={e => setWordMode(e.target.value)}
          className="w-full bg-game-bg border border-card-border rounded-lg p-2 text-white mb-2"
        >
          <option value="preset">预设词库</option>
          <option value="ai">AI生成</option>
          <option value="mixed">混合模式</option>
        </select>
        {wordMode === 'mixed' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">AI比例:</span>
            <input
              type="range"
              min="0" max="1" step="0.1"
              value={aiRatio}
              onChange={e => setAiRatio(parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs text-gray-300 w-8">{Math.round(aiRatio * 100)}%</span>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        className="mt-4 w-full py-2 bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors"
      >
        保存配置
      </button>
    </div>
  );
}
