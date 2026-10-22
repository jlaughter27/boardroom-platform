/**
 * M0-A3 — prisma/scripts/detect-baseline.cjs decides whether docker-entrypoint.sh
 * marks the db-push baseline migrations as applied. Getting it wrong is the
 * O-104 crash loop (resolve on a fresh DB) or a failed boot (no resolve on an
 * existing one), so each branch is pinned here: fresh, existing, unknown, and
 * an unreachable database.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';

interface ProbeClient {
  $queryRawUnsafe: (sql: string) => Promise<unknown>;
  $disconnect: () => Promise<void>;
}
interface DetectBaselineModule {
  PROBE_SQL: string;
  classify: (rows: unknown) => 'fresh' | 'existing' | 'unknown';
  detectBaseline: (deps?: {
    createClient?: () => ProbeClient;
    stdout?: { write: (s: string) => unknown };
    stderr?: { write: (s: string) => unknown };
  }) => Promise<number>;
}

const SCRIPT = path.resolve(__dirname, '../../../prisma/scripts/detect-baseline.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PROBE_SQL, classify, detectBaseline } = require(SCRIPT) as DetectBaselineModule;

function sink() {
  let text = '';
  return { write: (s: string) => { text += s; return true; }, get text() { return text; } };
}

function fakeClient(result: unknown | Error): ProbeClient & { $queryRawUnsafe: ReturnType<typeof vi.fn>; $disconnect: ReturnType<typeof vi.fn> } {
  return {
    $queryRawUnsafe: vi.fn(async () => { if (result instanceof Error) throw result; return result; }),
    $disconnect: vi.fn(async () => undefined),
  };
}

async function run(result: unknown | Error) {
  const client = fakeClient(result);
  const stdout = sink();
  const stderr = sink();
  const code = await detectBaseline({ createClient: () => client, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text, client };
}

describe('classify', () => {
  it('fresh when memory_entries does not exist', () => {
    expect(classify([{ has_tables: false, has_history: false }])).toBe('fresh');
  });
  it('existing when memory_entries exists, with or without migration history', () => {
    expect(classify([{ has_tables: true, has_history: false }])).toBe('existing'); // legacy `db push` DB
    expect(classify([{ has_tables: true, has_history: true }])).toBe('existing'); // migrated DB
  });
  it('unknown for anything that is not a boolean answer', () => {
    expect(classify([])).toBe('unknown');
    expect(classify(undefined)).toBe('unknown');
    expect(classify([{}])).toBe('unknown');
    expect(classify([{ has_tables: 't' }])).toBe('unknown');
    expect(classify([{ has_tables: null }])).toBe('unknown');
  });
});

describe('detectBaseline', () => {
  it('probes memory_entries and _prisma_migrations', () => {
    expect(PROBE_SQL).toContain("to_regclass('public.memory_entries')");
    expect(PROBE_SQL).toContain("to_regclass('public._prisma_migrations')");
  });

  it('fresh branch: prints exactly "fresh", exits 0, disconnects', async () => {
    const r = await run([{ has_tables: false, has_history: false }]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('fresh');
    expect(r.stderr).toContain('has_tables=false has_history=false');
    expect(r.client.$queryRawUnsafe).toHaveBeenCalledWith(PROBE_SQL);
    expect(r.client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('existing branch: prints exactly "existing", exits 0', async () => {
    const r = await run([{ has_tables: true, has_history: false }]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('existing');
    expect(r.client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('unknown branch: prints "unknown" and exits 1 instead of guessing fresh', async () => {
    const r = await run([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('unknown');
    expect(r.stdout).not.toBe('fresh');
    expect(r.stderr).toContain('refusing to guess');
    expect(r.client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('unreachable database: nothing on stdout, exits 1', async () => {
    const r = await run(new Error("Can't reach database server at `localhost:5432`"));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('failed to inspect database');
    expect(r.client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('a client that cannot even be constructed: nothing on stdout, exits 1', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await detectBaseline({ createClient: () => { throw new Error('no generated client'); }, stdout, stderr });
    expect(code).toBe(1);
    expect(stdout.text).toBe('');
    expect(stderr.text).toContain('no generated client');
  });
});

describe('CLI entry point', () => {
  it('exits 1 with nothing on stdout when DATABASE_URL points at a closed port', () => {
    const res = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none?connect_timeout=2' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('detect-baseline: failed to inspect database');
  }, 40_000);
});
