import { describe, it, expect } from 'vitest';
import { signState, verifyState, STATE_MAX_AGE_MS } from '../../src/services/google-calendar.service';

describe('OAuth state (B-118)', () => {
  it('round-trips userId for the right provider', () => {
    const state = signState('user-1', 'calendar');
    expect(verifyState(state, 'calendar')).toBe('user-1');
  });

  it('includes a random nonce — two states for the same user differ', () => {
    const now = Date.now();
    expect(signState('user-1', 'gmail', now)).not.toBe(signState('user-1', 'gmail', now));
  });

  it('rejects the wrong provider', () => {
    expect(verifyState(signState('user-1', 'calendar'), 'gmail')).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const state = signState('user-1', 'calendar');
    const tampered = state.slice(0, -2) + (state.endsWith('00') ? '11' : '00');
    expect(verifyState(tampered, 'calendar')).toBeNull();
  });

  it('rejects a tampered userId', () => {
    const state = signState('user-1', 'calendar');
    expect(verifyState(state.replace('user-1', 'user-2'), 'calendar')).toBeNull();
  });

  it('rejects states older than 10 minutes', () => {
    const issued = Date.now() - STATE_MAX_AGE_MS - 1000;
    const state = signState('user-1', 'calendar', issued);
    expect(verifyState(state, 'calendar')).toBeNull();
    // ...but accepts one just inside the window
    const fresh = signState('user-1', 'calendar', Date.now() - STATE_MAX_AGE_MS + 5000);
    expect(verifyState(fresh, 'calendar')).toBe('user-1');
  });

  it('rejects legacy 3-part states (no timestamp/nonce)', () => {
    expect(verifyState('calendar:user-1:deadbeef', 'calendar')).toBeNull();
    expect(verifyState(undefined, 'calendar')).toBeNull();
  });
});
