// Integration tests for authentication flows
// Tests user registration, login, token validation, and session management
// Requires test database and Redis running (via docker-compose.test.yml)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';
import { hashPassword } from '../../packages/boardroom-ai/server/src/middleware/auth';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-e2e';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-e2e';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

// Test data
const TEST_USER = {
  email: `test-auth-${Date.now()}@boardroom.test`,
  password: 'TestPassword123!',
  name: 'Integration Test User'
};

describe('Authentication Integration Tests', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(() => {
    // Ensure we're in test mode
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    // Clean up test data if needed
  });

  describe('User Registration', () => {
    it('POST /auth/register creates new user and sets auth cookie', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: TEST_USER.email,
          password: TEST_USER.password,
          name: TEST_USER.name
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('name', TEST_USER.name);
      
      // Check for auth cookie
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('boardroom_token=');
      
      authCookie = setCookie[0];
      userId = response.body.userId;
    });

    it('POST /auth/register with duplicate email returns 409', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: TEST_USER.email, // Same email as above
          password: 'AnotherPassword123!',
          name: 'Duplicate User'
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error', 'validation_failed');
      expect(response.body.details[0]).toHaveProperty('field', 'email');
    });

    it('POST /auth/register with invalid email returns 422', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'not-an-email',
          password: 'Password123!',
          name: 'Invalid User'
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error', 'validation_failed');
    });
  });

  describe('User Login', () => {
    it('POST /auth/login with valid credentials returns auth cookie', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: TEST_USER.email,
          password: TEST_USER.password
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('name', TEST_USER.name);
      
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('boardroom_token=');
    });

    it('POST /auth/login with invalid password returns 401', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: TEST_USER.email,
          password: 'WrongPassword123!'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
    });

    it('POST /auth/login with non-existent email returns 401', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@boardroom.test',
          password: 'Password123!'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
    });
  });

  describe('Session Management', () => {
    it('GET /auth/me with valid cookie returns user info', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('userId', userId);
      expect(response.body).toHaveProperty('email', TEST_USER.email);
      expect(response.body).toHaveProperty('name', TEST_USER.name);
    });

    it('GET /auth/me without cookie returns 401', async () => {
      const response = await request(app)
        .get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
    });

    it('POST /auth/logout clears auth cookie', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('boardroom_token=;');
      
      // Verify session is invalidated
      const meResponse = await request(app)
        .get('/auth/me')
        .set('Cookie', authCookie);

      expect(meResponse.status).toBe(401);
    });

    it('Rate limiting on auth endpoints works', async () => {
      const requests = Array(10).fill(null).map(() => 
        request(app)
          .post('/auth/login')
          .send({
            email: 'rate@limit.test',
            password: 'Password123!'
          })
      );

      const responses = await Promise.all(requests);
      // At least some should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });
});
