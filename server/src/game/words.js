// Preset word database
const WORD_DATABASE = {
  people: [
    '孙悟空', '哈利波特', '蜘蛛侠', '关羽', '爱因斯坦',
    '莫扎特', '李白', '拿破仑', '诸葛亮', '福尔摩斯',
    '美人鱼', '圣诞老人', '白雪公主', '孙中山', '钢铁侠',
    '成龙', '周杰伦', '梵高', '牛顿', '曹操',
  ],
  food: [
    '苹果', '火锅', '寿司', '披萨', '月饼',
    '巧克力', '冰淇淋', '饺子', '汉堡', '拉面',
    '西瓜', '蛋糕', '烤鸭', '麻辣烫', '奶茶',
    '棉花糖', '糖葫芦', '臭豆腐', '粽子', '鸡翅',
  ],
  items: [
    '雨伞', '手机', '眼镜', '钢琴', '自行车',
    '电脑', '书包', '篮球', '吉他', '望远镜',
    '口红', '帐篷', '滑板', '魔方', '风筝',
    '相机', '耳机', '闹钟', '花瓶', '台灯',
  ],
};

const CATEGORIES = Object.keys(WORD_DATABASE);

export async function selectWord(wordConfig, hostModel) {
  const useAI = wordConfig.mode === 'ai' ||
    (wordConfig.mode === 'mixed' && Math.random() < wordConfig.aiRatio);

  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  if (useAI && hostModel) {
    try {
      return await generateWordWithAI(category, hostModel);
    } catch (err) {
      console.error('AI word generation failed, falling back to preset:', err);
    }
  }

  const words = WORD_DATABASE[category];
  const word = words[Math.floor(Math.random() * words.length)];

  const categoryNames = { people: '人物', food: '食物', items: '用品' };
  return { word, category: categoryNames[category] || category };
}

async function generateWordWithAI(category, model) {
  const { callOpenRouter } = await import('../ai/openrouter.js');
  const categoryNames = { people: '人物', food: '食物', items: '用品' };
  const categoryName = categoryNames[category];

  const response = await callOpenRouter(model, [
    {
      role: 'system',
      content: `你是一个词语生成器。请生成一个适合猜词游戏的${categoryName}类词语。要求：1）大众熟知 2）不要太简单也不要太生僻 3）只回复词语本身，不要有任何其他内容`,
    },
    { role: 'user', content: `请生成一个${categoryName}类的词语` },
  ]);

  return { word: response.trim(), category: categoryName };
}

export function getWordCount() {
  return Object.values(WORD_DATABASE).reduce((sum, words) => sum + words.length, 0);
}
