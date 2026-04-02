import { callOpenRouter } from './openrouter.js';

const PERSONALITY_TRAITS = {
  analytical: '你是一个分析型玩家，喜欢通过逻辑推理来思考问题，发言时条理清晰。',
  cautious: '你是一个谨慎型玩家，不轻易下结论，会仔细观察后再发言，语气偏保守。',
  intuitive: '你是一个直觉型玩家，经常凭感觉做判断，发言自然随意。',
  aggressive: '你是一个积极型玩家，喜欢主动出击，敢于大胆猜测，发言直接有力。',
};

function getPersonalityPrompt(personality) {
  return PERSONALITY_TRAITS[personality] || PERSONALITY_TRAITS.analytical;
}

function formatQAHistory(questions) {
  if (!questions?.length) return '暂无提问记录。';
  return questions.map((q, i) =>
    `问题${i + 1}（${q.playerId}）：${q.question} → 主持人回答：${q.answer || '等待回答'}`
  ).join('\n');
}

function formatDiscussions(discussions) {
  if (!discussions?.length) return '暂无讨论。';
  return discussions.map(d => `${d.playerId}：${d.message}`).join('\n');
}

const PROMPTS = {
  host: (ctx) => ({
    system: `你是"谁是卧底"游戏的AI主持人。当前要猜的词语是"${ctx.word}"（类别：${ctx.category}）。
游戏队会向你提问，你只能回答"是"或"否"。
规则：
- 严格只回答"是"或"否"两个字之一
- 根据词语的真实属性如实回答
- 如果问题模糊或无法判断，倾向于回答"否"
- 不要添加任何解释或额外文字`,
    user: `游戏队提问：${ctx.question}\n请回答"是"或"否"：`,
  }),

  omniscient_discuss: (ctx) => ({
    system: `你在"谁是卧底"游戏中担任全知者角色。你知道词语是"${ctx.word}"，但你必须隐藏这一事实。
${getPersonalityPrompt(ctx.personality)}

策略要求（平衡型）：
- 你不能直接说出或暗示词语
- 在讨论中表现得像不知道词语的人
- 偶尔可以提出有启发性的观点来引导队友，但要自然
- 表现出思考和不确定的态度
- ${ctx.brief ? '简短发言，1-2句话' : '发言2-3句话'}

当前讨论记录：
${formatDiscussions(ctx.discussions)}

提问记录：
${formatQAHistory(ctx.questions)}`,
    user: '请发表你的讨论意见：',
  }),

  guesser_discuss: (ctx) => ({
    system: `你在"谁是卧底"游戏中担任游戏队成员，你不知道要猜的词语。
${getPersonalityPrompt(ctx.personality)}
词语类别可能是：人物、食物或用品。
${ctx.brief ? '简短发言，1-2句话。' : '发言2-3句话。'}

当前讨论记录：
${formatDiscussions(ctx.discussions)}

提问记录：
${formatQAHistory(ctx.questions)}`,
    user: '请发表你的讨论意见，分析目前的线索：',
  }),

  omniscient_question: (ctx) => ({
    system: `你在"谁是卧底"游戏中担任全知者。你知道词语是"${ctx.word}"（类别：${ctx.category}），但必须隐藏自己的身份。
${getPersonalityPrompt(ctx.personality)}

策略（平衡型）：
- 约60%的时候问普通问题（看起来像不知道词语的人）
- 约40%的时候问有引导性的问题（帮助队友缩小范围，但不能太明显）
- 引导方式：不要直接问"是不是${ctx.word}"，而是问一些能缩小范围的属性问题
- 不要连续问引导性问题，要穿插普通问题
- 只问一个是非问题（只能用"是"或"否"回答的问题）

已有的提问记录：
${formatQAHistory(ctx.questions)}

讨论记录：
${formatDiscussions(ctx.discussions)}`,
    user: '请提出你的问题（只能是一个是非问题）：',
  }),

  guesser_question: (ctx) => ({
    system: `你在"谁是卧底"游戏中担任游戏队成员，你不知道要猜的词语。
${getPersonalityPrompt(ctx.personality)}
词语类别可能是：人物、食物或用品。
根据已有的问答信息进行推理，提出一个有助于缩小范围的是非问题。
只问一个问题，且只能用"是"或"否"回答。

已有的提问记录：
${formatQAHistory(ctx.questions)}

讨论记录：
${formatDiscussions(ctx.discussions)}`,
    user: '请提出你的问题（只能是一个是非问题）：',
  }),

  observer_vote: (ctx) => ({
    system: `你在"谁是卧底"游戏中担任观察队队长。你知道词语是"${ctx.word}"。
你的任务是观察游戏队的讨论和提问，判断谁是全知者（知道词语的人）。

游戏队成员：${ctx.gameTeamPlayers.join(', ')}

分析线索：
- 全知者会试图隐藏自己，但可能在提问中不小心暴露
- 关注谁的问题更有方向性、更精准
- 关注讨论中谁的发言更有引导性

讨论记录：
${formatDiscussions(ctx.discussions)}

提问记录：
${formatQAHistory(ctx.questions)}

${getPersonalityPrompt(ctx.personality)}`,
    user: `请从以下玩家中选择你认为的全知者，只回复玩家ID：${ctx.gameTeamPlayers.join(', ')}`,
  }),

  guesser_guess: (ctx) => ({
    system: `你在"谁是卧底"游戏中。根据所有的问答记录，尝试猜测词语。
词语类别可能是：人物、食物或用品。
如果你有足够的信心，回复猜测的词语。如果信息还不够，回复"SKIP"。

提问记录：
${formatQAHistory(ctx.questions)}

讨论记录：
${formatDiscussions(ctx.discussions)}`,
    user: '请猜测词语（如果不确定回复SKIP）：',
  }),
};

export async function getAIResponse(type, context) {
  const promptFn = PROMPTS[type];
  if (!promptFn) throw new Error(`Unknown prompt type: ${type}`);

  const { system, user } = promptFn(context);
  const model = context.model;

  const response = await callOpenRouter(model, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], {
    maxTokens: type === 'host' ? 8 : type === 'observer_vote' ? 32 : 128,
    temperature: type === 'host' ? 0.1 : 0.7,
  });

  // Post-process host answers to ensure only 是/否
  if (type === 'host') {
    const cleaned = response.trim();
    if (cleaned.includes('是') && !cleaned.includes('否')) return '是';
    if (cleaned.includes('否') && !cleaned.includes('是')) return '否';
    return cleaned.startsWith('是') ? '是' : '否';
  }

  // Post-process vote to extract player ID
  if (type === 'observer_vote') {
    const match = response.match(/ai_\d|human_\d/);
    if (match) return match[0];
    // Try to find any player ID mentioned
    for (const pid of context.gameTeamPlayers) {
      if (response.includes(pid)) return pid;
    }
    // Fallback to random
    return context.gameTeamPlayers[Math.floor(Math.random() * context.gameTeamPlayers.length)];
  }

  return response.trim();
}
