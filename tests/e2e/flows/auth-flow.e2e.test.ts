// End-to-end tests for complete authentication flow
// Tests registration, login, session management, and security

import { describe, it, expect, beforeAll } from 'vitest';
import { BOARDROOM_URL, waitForServices, registerTestUser, authedFetch } from '../setup';

describe('Complete Authentication Flow', () => {
  beforeAll(async () => {
    await waitForServices();
  });

  describe('Full User Journey', () => {
    it('registers, logs in, accesses protected resource, logs out', async () => {
      // 1. Register
      const email = `full-journey-${Date.now()}@boardroom.test`;
      const registerRes = await fetch(`${BOARDROOM_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          password: 'JourneyPass123!', 
          name: 'Full Journey User' 
        }),
      });

      expect(registerRes.status).toBe(201);
      const registerBody = await registerRes.json();
      expect(registerBody).toHaveProperty('userId');
      
      const authCookie = registerRes.headers.get('set-cookie') || '';
      expect(authCookie).toContain('boardroom_token=');

      // 2. Access protected resource (memories)
      const memoriesRes = await authedFetch(`${BOARDROOM_URL}/memories`, authCookie);
      expect([200, 404]).toContain(memoriesRes.status);
      
      if (memoriesRes.status === 200) {
        const memoriesBody = await memoriesRes.json();
        expect(Array.isArray(memoriesBody)).toBe(true);
      }

      // 3. Get user info
      const meRes = await authedFetch(`${BOARDROOM_URL}/auth/me`, authCookie);
      expect(meRes.status).toBe(200);
      const meBody = await meRes.json();
      expect(meBody).toHaveProperty('email', email);
      expect(meBody).toHaveProperty('name', 'Full Journey User');

      // 4. Logout
      const logoutRes = await authedFetch(`${BOARDROOM_URL}/auth/logout`, authCookie, {
        method: 'POST',
      });
      expect(logoutRes.status).toBe(200);
      const logoutBody = await logoutRes.json();
      expect(logoutBody).toHaveProperty('status', 'ok');

      // 5. Verify session invalidated
      const meAfterLogout = await authedFetch(`${BOARDROOM_URL}/auth/me`, authCookie);
      expect(meAfterLogout.status).toBe(401);

      // 6. Login again
      const loginRes = await fetch(`${BOARDROOM_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'JourneyPass123!' }),
      });

      expect(loginRes.status).toBe(200);
      const loginBody = await loginRes.json();
      expect(loginBody).toHaveProperty('userId', registerBody.userId);
      expect(loginBody).toHaveProperty('name', 'Full Journey User');
    });
  });

  describe('Security & Validation', () => {
    it('rejects weak passwords', async () => {
      const res = await fetch(`${BOARDROOM_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: `weak-pass-${Date.now()}@boardroom.test`, 
          password: '123', // Too weak
          name: 'Weak Password User' 
        }),
      });

      // Should reject with 422 validation error
      expect([400, 422]).toContain(res.status);
    });

    it('rejects invalid email format', async () => {
      const res = await fetch(`${BOARDROOM_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: 'not-an-email', 
          password: 'ValidPass123!',
          name: 'Invalid Email User' 
        }),
      });

      // Should reject with 422 validation error
      expect([400, 422]).toContain(res.status);
    });

    it('enforces rate limiting on login attempts', async () => {
      const email = `rate-limit-${Date.now()}@boardroom.test`;
      const password = 'RateLimitPass123!';

      // Register first
      await fetch(`${BOARDROOM_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'Rate Limit User' }),
      });

      // Make multiple failed login attempts
      const requests = Array(10).fill(null).map(() => 
        fetch(`${BOARDROOM_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            email, 
            password: 'WrongPassword123!' // Wrong password
          }),
        })
      );

      const responses = await Promise.all(requests);
      // At least some should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});
