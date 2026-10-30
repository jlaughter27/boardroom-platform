/**
 * Lane G item 5 — production boot warns loudly while unverified agent headers
 * are still accepted (OMNIMIND_REQUIRE_AGENT_KEY != true). The default is NOT
 * flipped (solo mode relies on the header fast-path); the warning makes the
 * posture visible in every production boot log until an operator decides.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/logger', () => ({ logger: mockLogger }));
vi.mock('@boardroom/shared/node', () => ({ validateEnv: vi.fn() }));
vi.mock('../../../src/lib/crypto', () => ({ validateEncryptionKey: vi.fn() }));

import { agentKeyPostureWarning, validateOmniMindEnv } from '../../../src/lib/env';

describe('agentKeyPostureWarning', () => {
  it('production + flag unset/false/garbage → a warning naming the flag and the fix', () => {
    for (const v of [undefined, 'false', 'FALSE', 'no', '']) {
      const w = agentKeyPostureWarning({ NODE_ENV: 'production', OMNIMIND_REQUIRE_AGENT_KEY: v });
      expect(w).toMatch(/OMNIMIND_REQUIRE_AGENT_KEY/);
      expect(w).toMatch(/true/);
    }
  });
  it('production + flag true (any case / whitespace, as agent-context parses it) → no warning', () => {
    for (const v of ['true', 'TRUE', ' true ']) {
      expect(agentKeyPostureWarning({ NODE_ENV: 'production', OMNIMIND_REQUIRE_AGENT_KEY: v })).toBeNull();
    }
  });
  it('outside production → no warning (solo / dev mode is the intended use of the fast-path)', () => {
    expect(agentKeyPostureWarning({ NODE_ENV: 'development' })).toBeNull();
    expect(agentKeyPostureWarning({})).toBeNull();
  });
});

describe('validateOmniMindEnv logs the posture at boot', () => {
  const prev = { NODE_ENV: process.env.NODE_ENV, FLAG: process.env.OMNIMIND_REQUIRE_AGENT_KEY, ADMIN: process.env.OMNIMIND_ADMIN_KEY };
  beforeEach(() => { vi.clearAllMocks(); process.env.OMNIMIND_ADMIN_KEY = 'synthetic-admin-key'; });
  afterEach(() => {
    if (prev.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.NODE_ENV;
    if (prev.FLAG === undefined) delete process.env.OMNIMIND_REQUIRE_AGENT_KEY; else process.env.OMNIMIND_REQUIRE_AGENT_KEY = prev.FLAG;
    if (prev.ADMIN === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = prev.ADMIN;
  });

  it('NODE_ENV=production with the flag unset → WARN', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OMNIMIND_REQUIRE_AGENT_KEY;
    validateOmniMindEnv();
    expect(mockLogger.warn.mock.calls.some(c => String(c[0]).includes('OMNIMIND_REQUIRE_AGENT_KEY'))).toBe(true);
  });

  it('NODE_ENV=production with the flag true → no such WARN', () => {
    process.env.NODE_ENV = 'production';
    process.env.OMNIMIND_REQUIRE_AGENT_KEY = 'true';
    validateOmniMindEnv();
    expect(mockLogger.warn.mock.calls.some(c => String(c[0]).includes('OMNIMIND_REQUIRE_AGENT_KEY'))).toBe(false);
  });
});
