/**
 * `bench` subcommand smoke: argument parsing, percentile maths and a run
 * against injected write / stats functions (no network).
 */
import { describe, it, expect, vi } from 'vitest';
import { parseBenchArgs, percentile, summarize, runBench, BENCH_DEFAULT_N, BENCH_ASYNC_THRESHOLD_MS } from '../src/bench';

describe('parseBenchArgs', () => {
  it('defaults to --n 10, reads --user / env, validates ranges', () => {
    expect(parseBenchArgs([], {} as NodeJS.ProcessEnv)).toEqual({ n: BENCH_DEFAULT_N, domain: 'general', sinceHours: 24 });
    expect(parseBenchArgs(['--n', '3', '--user', 'u1', '--domain', 'code', '--since-hours', '6'], {} as NodeJS.ProcessEnv)).toEqual({ n: 3, userId: 'u1', domain: 'code', sinceHours: 6 });
    expect(parseBenchArgs([], { OMNIMIND_MCP_USER_ID: 'env-user' } as NodeJS.ProcessEnv).userId).toBe('env-user');
    expect(() => parseBenchArgs(['--n', '0'], {} as NodeJS.ProcessEnv)).toThrow(/--n/);
    expect(() => parseBenchArgs(['--n', 'ten'], {} as NodeJS.ProcessEnv)).toThrow(/--n/);
    expect(() => parseBenchArgs(['--n', '201'], {} as NodeJS.ProcessEnv)).toThrow(/--n/);
  });
});

describe('percentiles', () => {
  it('nearest-rank p50 / p95', () => {
    const s = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentile(s, 50)).toBe(1000);
    expect(percentile(s, 95)).toBe(1900);
    expect(percentile([], 95)).toBe(0);
    expect(summarize([300, 100, 200])).toEqual({ n: 3, p50Ms: 200, p95Ms: 300, minMs: 100, maxMs: 300, meanMs: 200 });
  });
});

describe('runBench', () => {
  it('times each write, reports local p50/p95, server stats when reachable, and the async recommendation', async () => {
    let t = 0;
    const now = () => t;
    const lines: string[] = [];
    const write = vi.fn(async (i: number) => { t += (i + 1) * 1000; });
    const stats = vi.fn().mockResolvedValue({ tool: 'memory_write', sinceHours: 24, count: 40, p50Ms: 1200, p95Ms: 3900, errorRate: 0.05 });
    const report = await runBench({ n: 4 }, { write, stats, now, log: l => lines.push(l) });
    expect(write).toHaveBeenCalledTimes(4);
    expect(report.local).toEqual({ n: 4, p50Ms: 2000, p95Ms: 4000, minMs: 1000, maxMs: 4000, meanMs: 2500 });
    expect(report.server?.p95Ms).toBe(3900);
    expect(report.errors).toBe(0);
    expect(report.recommendAsync).toBe(false);
    expect(lines.some(l => /local .*p50 2000 ms, p95 4000 ms/.test(l))).toBe(true);
    expect(lines.some(l => /server .*p95 3900 ms, error rate 5\.0%/.test(l))).toBe(true);
  });

  it('counts failed writes, survives an unreachable stats endpoint, and recommends async above the threshold', async () => {
    let t = 0;
    const lines: string[] = [];
    const write = vi.fn(async (i: number) => { t += BENCH_ASYNC_THRESHOLD_MS + 1; if (i === 1) throw new Error('503'); });
    const report = await runBench({ n: 2 }, { write, stats: () => Promise.reject(new Error('404 not found')), now: () => t, log: l => lines.push(l) });
    expect(report.errors).toBe(1);
    expect(report.server).toBeUndefined();
    expect(report.serverError).toBe('404 not found');
    expect(report.recommendAsync).toBe(true);
    expect(lines.some(l => /OMNIMIND_MCP_WRITE_EXTRACT=async/.test(l))).toBe(true);
  });
});
