export async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    return {
      recorder: mediaRecorder,
      start: () => {
        chunks.length = 0;
        mediaRecorder.start();
      },
      stop: () => new Promise((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          stream.getTracks().forEach(t => t.stop());
          resolve(blob);
        };
        mediaRecorder.stop();
      }),
    };
  } catch (err) {
    console.error('Microphone access denied:', err);
    return null;
  }
}

// FunASR WebSocket STT
export function createSTTConnection(apiUrl, apiKey, onResult) {
  if (!apiUrl || !apiKey) {
    // Fallback: use browser's Web Speech API
    return createBrowserSTT(onResult);
  }

  let ws = null;
  try {
    ws = new WebSocket(apiUrl);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.text) onResult(data.text);
    };
    ws.onerror = (err) => {
      console.error('FunASR error:', err);
    };
  } catch (err) {
    console.error('FunASR connection failed, using browser STT:', err);
    return createBrowserSTT(onResult);
  }

  return {
    sendAudio: (audioData) => {
      if (ws?.readyState === 1) ws.send(audioData);
    },
    close: () => ws?.close(),
  };
}

function createBrowserSTT(onResult) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return { sendAudio: () => {}, close: () => {}, fallback: true };
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    onResult(text);
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    close: () => recognition.abort(),
    isBrowserFallback: true,
  };
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
      // Fallback to browser TTS
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
