import { describe, it, expect, vi } from 'vitest';
import { createJobGuard, waitForAllJobsIdle, runningJobs, __resetJobGuardRegistryForTest } from '../../../src/jobs/job-guard';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('job guard (O-109 overlap + O-108 drain)', () => {
  it('skips a tick while the previous one is still running, then allows the next', async () => {
    __resetJobGuardRegistryForTest();
    const guard = createJobGuard('t1');
    let release!: () => void;
    const first = guard.run(() => new Promise<string>(r => { release = () => r('done'); }));
    expect(guard.isRunning()).toBe(true);
    expect(runningJobs()).toContain('t1');
    const second = await guard.run(async () => 'should-not-run');
    expect(second).toBeUndefined();
    release();
    expect(await first).toBe('done');
    expect(guard.isRunning()).toBe(false);
    expect(await guard.run(async () => 'third')).toBe('third');
  });

  it('waitForAllJobsIdle resolves true once in-flight ticks settle and false on timeout', async () => {
    __resetJobGuardRegistryForTest();
    const guard = createJobGuard('t2');
    let release!: () => void;
    void guard.run(() => new Promise<void>(r => { release = r; }));
    expect(await waitForAllJobsIdle(20)).toBe(false);
    release();
    expect(await waitForAllJobsIdle(1000)).toBe(true);
  });

  it('releases the guard even when the tick throws', async () => {
    const guard = createJobGuard('t3');
    await expect(guard.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(guard.isRunning()).toBe(false);
  });
});
