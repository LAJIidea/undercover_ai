const COSYVOICE_URL = process.env.COSYVOICE_API_URL ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2speech/generate';

export async function textToSpeech(text, voice = 'longxiaochun') {
  const apiKey = process.env.COSYVOICE_API_KEY;
  if (!apiKey) return null; // Graceful degradation

  try {
    const response = await fetch(COSYVOICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'cosyvoice-v1',
        input: { text },
        parameters: { voice },
      }),
    });

    if (!response.ok) {
      console.error('CosyVoice error:', response.status);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    return Buffer.from(audioBuffer);
  } catch (err) {
    console.error('TTS error:', err);
    return null;
  }
}
