/**
 * Wave 3 Track H — Phase 0.25.3 (OmniMind side)
 *
 * Mass-assignment defense on PATCH /user-profile. Mirrors the BoardRoom
 * surface; both must reject privilege fields independently because OmniMind
 * is the actual data writer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const updateProfileMock = vi.fn();
const getOrCreateProfileMock = vi.fn();
vi.mock('../../../src/services/user-profile.service', () => ({
  updateProfile: (...args: unknown[]) => updateProfileMock(...args),
  getOrCreateProfile: (...args: unknown[]) => getOrCreateProfileMock(...args),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: {} }));

async function buildApp() {
  const { userProfileRouter } = await import('../../../src/routes/user-profile.routes');
  const app = express();
  app.use(express.json());
  app.use('/user-profile', userProfileRouter);
  return app;
}

describe('PATCH /user-profile — mass-assignment defense (0.25.3)', () => {
  beforeEach(() => {
    updateProfileMock.mockReset();
    updateProfileMock.mockResolvedValue({ id: 'p1', industry: 'saas' });
    getOrCreateProfileMock.mockReset();
    getOrCreateProfileMock.mockResolvedValue({ id: 'p1' });
  });

  it('returns 400 when isAdmin is in body', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/user-profile')
      .set('x-user-id', 'u-1')
      .send({ industry: 'saas', isAdmin: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('privilege_escalation_blocked');
    expect(res.body.fields).toContain('isAdmin');
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it.each([
    'id',
    'userId',
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
      .patch('/user-profile')
      .set('x-user-id', 'u-1')
      .send({ industry: 'saas', [field]: 'malicious' });
    expect(res.status).toBe(400);
    expect(res.body.fields).toContain(field);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('returns 422 on unknown non-privilege fields (.strict())', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/user-profile')
      .set('x-user-id', 'u-1')
      .send({ randomKey: 'x' });
    expect(res.status).toBe(422);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('accepts clean update and calls service', async () => {
    const app = await buildApp();
    const res = await request(app)
      .patch('/user-profile')
      .set('x-user-id', 'u-1')
      .send({ industry: 'saas', onboardingComplete: true });
    expect(res.status).toBe(200);
    expect(updateProfileMock).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ industry: 'saas', onboardingComplete: true }),
      expect.anything()
    );
  });

  it('returns 400 when x-user-id header is missing', async () => {
    const app = await buildApp();
    const res = await request(app).patch('/user-profile').send({ industry: 'saas' });
    expect(res.status).toBe(400);
  });
});
