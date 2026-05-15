/**
 * Wave 3 Track H — Phase 0.25.3
 *
 * Mass-assignment defense on PATCH /profile. The route uses `.strict()` Zod
 * AND an explicit pre-validation privilege-field denylist that returns 400
 * (audit spec demands 400 specifically for this surface).
 *
 * What this guards: a malicious client cannot escalate by sliding
 * `isAdmin: true`, `subscriptionTier: 'enterprise'`, etc. into a PATCH body
 * and having it forwarded blindly to OmniMind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const updateUserProfileMock = vi.fn();
vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    updateUserProfile: (...args: unknown[]) => updateUserProfileMock(...args),
  },
}));

async function buildApp() {
  const { entitiesRouter } = await import('../../src/routes/entities.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = { userId: 'user-1', email: 'u@u.com', teamId: 't-1' };
    next();
  });
  app.use('/', entitiesRouter);
  return app;
}

describe('PATCH /profile — mass-assignment defense (0.25.3)', () => {
  beforeEach(() => {
    updateUserProfileMock.mockReset();
    updateUserProfileMock.mockResolvedValue({ ok: true });
  });

  it('returns 400 when isAdmin is in body', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/profile').send({ industry: 'saas', isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'privilege_escalation_blocked' });
    expect(res.body.fields).toContain('isAdmin');
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it.each([
    'id',
    'email',
    'subscription',
    'subscriptionTier',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'passwordHash',
  ])('returns 400 when %s is in body', async (field) => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/profile')
      .send({ industry: 'saas', [field]: 'malicious' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('privilege_escalation_blocked');
    expect(res.body.fields).toContain(field);
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it('returns 422 on unknown non-privilege fields (.strict() catches them)', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/profile').send({ randomField: 'x' });
    expect(res.status).toBe(422);
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it('accepts a clean update and forwards to OmniMind', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/profile').send({
      role: 'founder',
      industry: 'saas',
      onboardingComplete: true,
    });
    expect(res.status).toBe(200);
    expect(updateUserProfileMock).toHaveBeenCalledWith('user-1', {
      role: 'founder',
      industry: 'saas',
      onboardingComplete: true,
    });
  });

  it('fuzz: mixed privilege + valid fields still rejected', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/profile').send({
      industry: 'saas',
      onboardingComplete: true,
      isAdmin: true,
      email: 'attacker@evil.com',
    });
    expect(res.status).toBe(400);
    expect(res.body.fields).toEqual(expect.arrayContaining(['isAdmin', 'email']));
  });
});
