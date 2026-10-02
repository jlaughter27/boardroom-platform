// Phase 6 — OpenTelemetry bootstrap for BoardRoom AI.
//
// Active ONLY when OTEL_EXPORTER_OTLP_ENDPOINT is set. Must be the FIRST import
// in index.ts so http/express/undici are patched before app.ts loads them.
// Importing this module is a no-op without the env var (tests stay fast: the
// SDK packages are required lazily inside startOtel()).
//
// Trace propagation to OmniMind: omnimind-client uses Node's global fetch
// (undici). `@opentelemetry/auto-instrumentations-node` 0.80 ships
// `@opentelemetry/instrumentation-undici`, enabled by default, which creates a
// client span per fetch and injects W3C `traceparent`/`tracestate` into the
// outgoing headers. Verified at build time with an in-memory exporter (see
// tests/unit/otel.test.ts). `@opentelemetry/api` is reached through
// `@opentelemetry/sdk-node`'s `api` re-export (it is not a direct dependency).

import type { NodeSDK } from '@opentelemetry/sdk-node';
import { logger } from './logger';

export const OTEL_SERVICE_NAME = 'boardroom-ai';

let sdk: NodeSDK | null = null;

export function isOtelEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT) && sdk !== null;
}

export interface StartOtelOptions {
  /** Test seam: replace the OTLP exporter (e.g. InMemorySpanExporter). */
  traceExporter?: unknown;
  /** Test seam: skip the env gate. */
  force?: boolean;
}

export function startOtel(options: StartOtelOptions = {}): boolean {
  if (sdk) return true;
  if (!options.force && !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  try {
    // Lazy requires keep cold start + unit tests free of the SDK unless enabled.
    const sdkNode = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');

    // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_ENDPOINT (+ /v1/traces) and
    // OTEL_EXPORTER_OTLP_HEADERS from the environment.
    const traceExporter = (options.traceExporter ?? new OTLPTraceExporter()) as InstanceType<typeof OTLPTraceExporter>;

    sdk = new sdkNode.NodeSDK({
      resource: sdkNode.resources.resourceFromAttributes({
        'service.name': process.env.OTEL_SERVICE_NAME ?? OTEL_SERVICE_NAME,
        'deployment.environment': process.env.NODE_ENV ?? 'development',
      }),
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs spans are pure noise for an HTTP service.
          '@opentelemetry/instrumentation-fs': { enabled: false },
          '@opentelemetry/instrumentation-express': { enabled: true },
          '@opentelemetry/instrumentation-http': { enabled: true },
          // Node 22 global fetch — carries traceparent to OmniMind.
          '@opentelemetry/instrumentation-undici': { enabled: true },
        }),
      ],
    });
    sdk.start();
    logger.info('[otel] tracing started', {
      service: process.env.OTEL_SERVICE_NAME ?? OTEL_SERVICE_NAME,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '(custom exporter)',
    });

    const stop = () => { void shutdownOtel(); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return true;
  } catch (err) {
    sdk = null;
    logger.warn('[otel] failed to start — continuing without tracing', {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function shutdownOtel(): Promise<void> {
  const current = sdk;
  sdk = null;
  if (!current) return;
  try {
    await current.shutdown();
  } catch (err) {
    logger.warn('[otel] shutdown error', { message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Manual W3C context injection (belt and braces). Not used by omnimind-client
 * by default because undici auto-instrumentation already injects the header
 * and a duplicate `traceparent` is treated as invalid by receivers. Exposed for
 * callers that bypass fetch.
 */
export function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  if (!sdk) return headers;
  try {
    const { api } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
    api.propagation.inject(api.context.active(), headers);
  } catch { /* tracing is best-effort */ }
  return headers;
}

// Side effect on import: index.ts imports this module first.
startOtel();
