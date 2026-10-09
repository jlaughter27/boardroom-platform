/**
 * Phase 6 observability — verifies (1) the bootstrap is a no-op without
 * OTEL_EXPORTER_OTLP_ENDPOINT and (2) with the SDK started, Node's global
 * fetch (undici) carries a W3C `traceparent` to OmniMind through the real
 * omnimind-client, using an in-memory exporter instead of OTLP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { startOtel, shutdownOtel, isOtelEnabled, injectTraceHeaders } from '../../src/lib/otel';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

describe('otel bootstrap', () => {
  it('does nothing without OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(startOtel()).toBe(false);
    expect(isOtelEnabled()).toBe(false);
    expect(injectTraceHeaders({ a: 'b' })).toEqual({ a: 'b' });
  });
});

describe('traceparent propagation to OmniMind over fetch', () => {
  let server: http.Server;
  let base: string;
  const seen: Array<Record<string, string | string[] | undefined>> = [];
  let exporter: any;

  beforeAll(async () => {
    const { tracing } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
    exporter = new tracing.InMemorySpanExporter();
    expect(startOtel({ force: true, traceExporter: exporter })).toBe(true);

    server = http.createServer((req, res) => {
      seen.push(req.headers);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', dbConnected: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 60_000); // cold SDK + auto-instrumentations load is several seconds

  afterAll(async () => {
    await shutdownOtel();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('OmniMindClient.health() arrives with a valid traceparent and a client span is recorded', async () => {
    const { OmniMindClient } = await import('../../src/services/omnimind-client');
    const client = new OmniMindClient(base, 'test-key');
    const res = await client.health();
    expect(res.status).toBe('ok');
    expect(seen).toHaveLength(1);
    const tp = seen[0]['traceparent'];
    expect(typeof tp).toBe('string'); // exactly one header, never duplicated
    expect(tp as string).toMatch(TRACEPARENT);
    expect(seen[0]['x-api-key']).toBe('test-key');

    const { api } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
    const provider = api.trace.getTracerProvider() as any;
    const forceFlush = provider?.forceFlush ?? provider?.getDelegate?.()?.forceFlush;
    if (typeof forceFlush === 'function') await forceFlush.call(provider.getDelegate?.() ?? provider);
    const spans = exporter.getFinishedSpans();
    const clientSpan = spans.find((s: any) => s.kind === 2 /* CLIENT */);
    expect(clientSpan).toBeDefined();
    expect((tp as string).split('-')[1]).toBe(clientSpan.spanContext().traceId);
  }, 30_000);
});
