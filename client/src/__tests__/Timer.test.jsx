import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import Timer from '../components/Timer.jsx';

describe('Timer component', () => {
  it('shows full duration when startTime is null', () => {
    const { container } = render(<Timer startTime={null} duration={45000} />);
    expect(container.textContent).toBe('00:45');
  });

  it('counts down when startTime is provided', async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    const { container } = render(<Timer startTime={startTime} duration={45000} />);

    // Initial render shows 00:45
    expect(container.textContent).toBe('00:45');

    // Advance 5 seconds
    await act(async () => { vi.advanceTimersByTime(5100); });

    // Should show approximately 00:40
    expect(container.textContent).toMatch(/00:3\d|00:40/);

    vi.useRealTimers();
  });

  it('shows 00:00 when time has fully elapsed', async () => {
    vi.useFakeTimers();
    const startTime = Date.now();
    const { container } = render(<Timer startTime={startTime} duration={10000} />);

    // Advance 11 seconds (past duration)
    await act(async () => { vi.advanceTimersByTime(11000); });

    expect(container.textContent).toBe('00:00');
    vi.useRealTimers();
  });

  it('shows 7 minutes initially for questioning timer', () => {
    const startTime = Date.now();
    const { container } = render(<Timer startTime={startTime} duration={420000} />);
    expect(container.textContent).toMatch(/07:00|06:5\d/);
  });
});
