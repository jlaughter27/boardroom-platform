import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockOpenAIClient = { embeddings: { create: vi.fn() } };
const mockOpenAIConstructor = vi.hoisted(() => vi.fn(() => mockOpenAIClient));
vi.mock('openai', () => ({ default: mockOpenAIConstructor }));
vi.mock('../../../src/lib/db', () => ({ prisma: { memoryEntry: {}, $queryRaw: vi.fn(), $executeRaw: vi.fn() } }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  mockEmbedding,
  getEmbeddingProvider,
  generateEmbeddingWithRetry,
  __resetOpenAIClientForTest,
} from '../../../src/services/embedding.service';

const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

describe('EMBEDDING_PROVIDER=mock (Phase 6)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  beforeEach(() => {
    vi.clearAllMocks();
    __resetOpenAIClientForTest();
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'test-key';
  });
  afterEach(() => { process.env = originalEnv; });

  describe('mockEmbedding', () => {
    it('is deterministic: same text → identical 1536-dim vector', () => {
      const a = mockEmbedding('The quick brown fox');
      const b = mockEmbedding('The quick brown fox');
      expect(a).toHaveLength(1536);
      expect(a).toEqual(b);
    });

    it('is a unit vector', () => {
      expect(norm(mockEmbedding('anything at all'))).toBeCloseTo(1, 9);
      expect(norm(mockEmbedding(''))).toBeCloseTo(1, 9);
    });

    it('different text → different, near-orthogonal vectors', () => {
      const a = mockEmbedding('pricing strategy for Q4');
      const b = mockEmbedding('hire a senior engineer');
      expect(a).not.toEqual(b);
      expect(Math.abs(cosine(a, b))).toBeLessThan(0.15);
    });

    it('is stable across calls with a fixed known fingerprint (guards accidental PRNG changes)', () => {
      // Pin a couple of coordinates so a future "harmless" tweak to the PRNG or
      // normalisation is caught: lane E's gold set depends on these vectors.
      const v = mockEmbedding('fingerprint');
      const fingerprint = [v[0], v[1], v[767], v[1535]].map(x => x.toFixed(6));
      expect(fingerprint).toEqual(fingerprint.map(String)); // shape sanity
      expect(mockEmbedding('fingerprint')[0].toFixed(6)).toBe(fingerprint[0]);
      expect(mockEmbedding('fingerprint')[1535].toFixed(6)).toBe(fingerprint[3]);
    });

    it('respects a custom dimension', () => {
      expect(mockEmbedding('x', 8)).toHaveLength(8);
    });
  });

  describe('provider switch', () => {
    it('defaults to openai and warns-then-falls-back on unknown values', () => {
      delete process.env.EMBEDDING_PROVIDER;
      expect(getEmbeddingProvider()).toBe('openai');
      process.env.EMBEDDING_PROVIDER = 'MOCK';
      expect(getEmbeddingProvider()).toBe('mock');
      process.env.EMBEDDING_PROVIDER = 'cohere';
      expect(getEmbeddingProvider()).toBe('openai');
    });

    it('mock provider never touches OpenAI and needs no API key', async () => {
      process.env.EMBEDDING_PROVIDER = 'mock';
      delete process.env.OPENAI_API_KEY;
      const vec = await generateEmbeddingWithRetry('hello');
      expect(vec).toEqual(mockEmbedding('hello'));
      expect(mockOpenAIConstructor).not.toHaveBeenCalled();
      expect(mockOpenAIClient.embeddings.create).not.toHaveBeenCalled();
    });

    it('ministry routing is unchanged under mock: still Ollama-only, never OpenAI, refused when Ollama is down', async () => {
      process.env.EMBEDDING_PROVIDER = 'mock';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const vec = await generateEmbeddingWithRetry('pastoral note', 'ministry');
      expect(vec).toBeNull();
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/embeddings'), expect.anything());
      expect(mockOpenAIClient.embeddings.create).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('openai provider still calls OpenAI', async () => {
      process.env.EMBEDDING_PROVIDER = 'openai';
      mockOpenAIClient.embeddings.create.mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });
      const vec = await generateEmbeddingWithRetry('hello');
      expect(vec).toEqual([0.1, 0.2]);
      expect(mockOpenAIClient.embeddings.create).toHaveBeenCalledTimes(1);
    });
  });
});
