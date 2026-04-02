import { useState, useEffect } from 'react';

export default function Timer({ startTime, duration }) {
  const [remaining, setRemaining] = useState(duration);

  useEffect(() => {
    if (!startTime) {
      setRemaining(duration);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(interval);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, duration]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const isLow = remaining < 60000;

  return (
    <div className={`font-mono text-lg font-bold tabular-nums
      ${isLow ? 'text-red-400 animate-pulse' : 'text-white'}`}>
      {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  );
}
