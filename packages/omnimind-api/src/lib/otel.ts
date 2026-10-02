/**
 * Phase 6 — OpenTelemetry bootstrap for OmniMind (service name `omnimind-api`).
 *
 * This module is imported as the FIRST line of `src/index.ts` so the
 * auto-instrumentations hook `require()` before express / pg are loaded.
 * It is a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (and never runs
 * under NODE_ENV=test). Enabled instrumentations: http, express, pg. Prisma is
 * not part of the installed auto-instrumentations bundle (checked 2026-10-02),
 * so DB spans come from `pg` underneath Prisma's driver.
 *
 * Trace context (`traceparent`) from BoardRoom is picked up by the http
 * instrumentation automatically, so BoardRoom → OmniMind spans join.
 */
import { logger } from './logger';

// Typed loosely so the module never hard-fails when the SDK surface shifts.
type NodeSdkLike = { start(): void; shutdown(): Promise<void> };

let sdk: NodeSdkLike | null = null;

export function isOtelEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) && process.env.NODE_ENV !== 'test';
}

export function startOtel(): boolean {
  if (sdk) return true;
  if (!isOtelEnabled()) return false;

  try {
    // Lazy requires keep the (large) OTel graph out of memory when disabled.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, '');
    const traceExporter = new OTLPTraceExporter({
      // Honour a full /v1/traces URL or a base endpoint.
      url: endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint}/v1/traces`,
      headers: parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    });

    const instance = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'omnimind-api',
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-pg': { enabled: true },
          // Noise reducers — these emit a span per syscall.
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-dns': { enabled: false },
          '@opentelemetry/instrumentation-net': { enabled: false },
        }),
      ],
    });
    instance.start();
    sdk = instance;
    logger.info('[otel] tracing started', { serviceName: process.env.OTEL_SERVICE_NAME || 'omnimind-api', endpoint });
    return true;
  } catch (err) {
    logger.warn('[otel] failed to start tracing — continuing without it', { error: (err as Error).message });
    sdk = null;
    return false;
  }
}

export async function shutdownOtel(): Promise<void> {
  if (!sdk) return;
  const s = sdk;
  sdk = null;
  try {
    await s.shutdown();
  } catch (err) {
    logger.warn('[otel] shutdown error', { error: (err as Error).message });
  }
}

/** `OTEL_EXPORTER_OTLP_HEADERS="k1=v1,k2=v2"` → record. Exported for tests. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Self-start on import so instrumentation precedes express/pg requires.
startOtel();
