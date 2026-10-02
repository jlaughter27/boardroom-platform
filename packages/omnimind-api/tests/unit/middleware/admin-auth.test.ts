import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAdminKey, isAdminRequest, __resetAdminAuthForTest } from '../../../src/middleware/admin-auth';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('requireAdminKey (F-104)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  const envBackup = { key: process.env.OMNIMIND_ADMIN_KEY, node: process.env.NODE_ENV };

  beforeEach(() => {
    __resetAdminAuthForTest();
    req = { path: '/stats', headers: {}, ip: '1.2.3.4' };
    res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    next = vi.fn();
  });
  afterEach(() => {
    if (envBackup.key === undefined) delete process.env.OMNIMIND_ADMIN_KEY; else process.env.OMNIMIND_ADMIN_KEY = envBackup.key;
    process.env.NODE_ENV = envBackup.node;
  });

  it('401 when the key is configured and the header is missing', () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    requireAdminKey(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401 when the header is wrong (and a different length)', () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    req.headers = { 'x-admin-key': 'nope' };
    requireAdminKey(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('passes with the correct x-admin-key', () => {
    process.env.OMNIMIND_ADMIN_KEY = 'admin-secret';
    req.headers = { 'x-admin-key': 'admin-secret' };
    requireAdminKey(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(isAdminRequest(req as Request)).toBe(true);
  });

  it('503 in production when OMNIMIND_ADMIN_KEY is unset', () => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    process.env.NODE_ENV = 'production';
    requireAdminKey(req as Request, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'admin_disabled' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('passes (dev convenience) outside production when unset; isAdminRequest stays false', () => {
    delete process.env.OMNIMIND_ADMIN_KEY;
    process.env.NODE_ENV = 'test';
    requireAdminKey(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(isAdminRequest(req as Request)).toBe(false);
  });
});
