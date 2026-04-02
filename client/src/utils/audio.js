// STT config cache
let sttConfigCache = null;

async function fetchSTTConfig() {
  if (sttConfigCache) return sttConfigCache;
  try {
    const res = await fetch('/api/stt-config');
    sttConfigCache = await res.json();
  } catch {
    sttConfigCache = { available: false, url: '', key: '' };
  }
  return sttConfigCache;
}

// Create a unified STT interface that tries FunASR first, falls back to browser
export async function createSTTHandler(onResult, onError) {
  const config = await fetchSTTConfig();

  if (config.available) {
    try {
      const handler = new FunASRHandler(config.url, config.key, onResult, onError);
      await handler.init();
      return handler;
    } catch (err) {
      console.warn('FunASR init failed, falling back to browser STT:', err);
      if (onError) onError('FunASR连接失败，使用浏览器语音识别');
    }
  }

  // Fallback to browser STT
  return new BrowserSTTHandler(onResult, onError);
}

// FunASR: microphone capture → audio chunking → WebSocket send → result callback
class FunASRHandler {
  constructor(apiUrl, apiKey, onResult, onError) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.onResult = onResult;
    this.onError = onError;
    this.ws = null;
    this.stream = null;
    this.recorder = null;
    this.isBrowserFallback = false;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const url = this.apiKey
        ? `${this.apiUrl}?token=${this.apiKey}`
        : this.apiUrl;

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        this.ws.close();
        reject(new Error('FunASR WebSocket connection timeout'));
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        // Send initial config message (FunASR protocol)
        this.ws.send(JSON.stringify({
          mode: 'online',
          chunk_size: [5, 10, 5],
          wav_name: 'microphone',
          is_speaking: true,
          wav_format: 'pcm',
          audio_fs: 16000,
        }));
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // FunASR returns text in "text" field
          if (data.text && data.text.trim()) {
            this.onResult(data.text.trim());
          }
        } catch {
          // Binary response or parse error - ignore
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
      };
    });
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });

      // Use AudioContext to get raw PCM data for FunASR
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioContext.createMediaStreamSource(this.stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (this.ws?.readyState === 1) {
          const float32 = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16 PCM
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
          }
          this.ws.send(int16.buffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      this._audioContext = audioContext;
      this._processor = processor;
      this._source = source;
    } catch (err) {
      if (this.onError) this.onError('麦克风权限被拒绝');
      throw err;
    }
  }

  stop() {
    // Signal end of speech to FunASR
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ is_speaking: false }));
    }

    // Clean up audio pipeline
    if (this._processor) {
      this._processor.disconnect();
      this._source?.disconnect();
      this._processor = null;
      this._source = null;
    }
    if (this._audioContext) {
      this._audioContext.close().catch(() => {});
      this._audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  close() {
    this.stop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Browser Web Speech API fallback
class BrowserSTTHandler {
  constructor(onResult, onError) {
    this.onResult = onResult;
    this.onError = onError;
    this.isBrowserFallback = true;
    this.recognition = null;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'zh-CN';
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        this.onResult(text);
      };
      this.recognition.onerror = (e) => {
        if (this.onError && e.error !== 'aborted') {
          this.onError('语音识别错误: ' + e.error);
        }
      };
    }
  }

  async start() {
    if (!this.recognition) {
      if (this.onError) this.onError('浏览器不支持语音识别，请使用文字输入');
      return;
    }
    this.recognition.start();
  }

  stop() {
    this.recognition?.stop();
  }

  close() {
    this.recognition?.abort();
  }
}

// Legacy alias for backward compatibility
export function createSTTConnection(apiUrl, apiKey, onResult) {
  if (!apiUrl || !apiKey) return new BrowserSTTHandler(onResult);
  // For direct usage without async init
  return new BrowserSTTHandler(onResult);
}

// Play TTS audio
export async function playTTS(text) {
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      return playBrowserTTS(text);
    }
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(audioUrl);
  } catch {
    playBrowserTTS(text);
  }
}

function playBrowserTTS(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    window.speechSynthesis.speak(utterance);
  }
}
