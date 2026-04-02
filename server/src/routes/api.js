import express from 'express';
import { getAllModels } from '../ai/openrouter.js';
import { getWordCount } from '../game/words.js';
import { textToSpeech } from '../services/tts.js';

export const apiRouter = express.Router();

// Get available AI models
apiRouter.get('/models', (req, res) => {
  res.json(getAllModels());
});

// Health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
    ttsConfigured: !!process.env.COSYVOICE_API_KEY,
    sttConfigured: !!process.env.FUNASR_API_KEY,
    wordCount: getWordCount(),
  });
});

// STT config endpoint - exposes FunASR connection info to clients
apiRouter.get('/stt-config', (req, res) => {
  const url = process.env.FUNASR_API_URL || '';
  const key = process.env.FUNASR_API_KEY || '';
  res.json({
    available: !!(url && key),
    url: url,
    key: key,
  });
});

// TTS endpoint
apiRouter.post('/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const audio = await textToSpeech(text, voice);
  if (!audio) {
    return res.status(503).json({ error: 'TTS service unavailable' });
  }

  res.set('Content-Type', 'audio/wav');
  res.send(audio);
});
