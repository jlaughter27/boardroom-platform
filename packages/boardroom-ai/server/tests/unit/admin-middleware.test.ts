import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireAdmin, isAdminEmail } from '../../src/middleware/admin.middleware';
import { omnimindClient } from '../../src/services/omnimind-client';
import type { Response } from 'express';
import type { AuthRequest } from '../../src/middleware/auth';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: { getUserById: vi.fn() },
}));

function mockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe('admin.middleware (B-101)', () => {
  const originalAdmins = process.env.ADMIN_EMAILS;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = ' Josh@Example.com, ops@example.com ';
  });
  afterEach(() => {
    if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdmins;
  });

  it('isAdminEmail is case-insensitive and trims entries', () => {
    expect(isAdminEmail('josh@example.com')).toBe(true);
    expect(isAdminEmail('OPS@EXAMPLE.COM')).toBe(true);
    expect(isAdminEmail('someone@example.com')).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it('isAdminEmail is false for everyone when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS;
    expect(isAdminEmail('josh@example.com')).toBe(false);
  });

  it('401 when unauthenticated', async () => {
    const res = mockRes(); const next = vi.fn();
    await requireAdmin({} as AuthRequest, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 {error:"forbidden"} for a non-admin email', async () => {
    const res = mockRes(); const next = vi.fn();
    await requireAdmin({ auth: { userId: 'u1', email: 'nobody@example.com', teamId: 't' } } as AuthRequest, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
    expect(omnimindClient.getUserById).not.toHaveBeenCalled();
  });

  it('passes for an allow-listed email in the JWT', async () => {
    const res = mockRes(); const next = vi.fn();
    await requireAdmin({ auth: { userId: 'u1', email: 'josh@example.com', teamId: 't' } } as AuthRequest, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('falls back to OmniMind lookup when the JWT lacks an email', async () => {
    (omnimindClient.getUserById as any).mockResolvedValue({ id: 'u1', email: 'ops@example.com', name: 'Ops', teamId: 't' });
    const res = mockRes(); const next = vi.fn();
    await requireAdmin({ auth: { userId: 'u1', teamId: 't' } } as unknown as AuthRequest, res, next);
    expect(omnimindClient.getUserById).toHaveBeenCalledWith('u1');
    expect(next).toHaveBeenCalled();
  });

  it('403 when the OmniMind lookup fails', async () => {
    (omnimindClient.getUserById as any).mockRejectedValue(new Error('down'));
    const res = mockRes(); const next = vi.fn();
    await requireAdmin({ auth: { userId: 'u1', teamId: 't' } } as unknown as AuthRequest, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
