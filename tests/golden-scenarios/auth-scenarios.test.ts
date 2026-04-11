// Golden Test Scenarios: Authentication & Authorization
// Comprehensive scenarios covering user registration, login, session management,
// rate limiting, and security controls.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: Authentication & Authorization', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    // Clean up any test data if needed
  });

  // SCENARIO 1: Complete user registration flow
  describe('User Registration Flow', () => {
    const uniqueEmail = `golden-reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@boardroom.test`;

    it('SCENARIO 1.1: should register new user with valid credentials', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: uniqueEmail,
          password: 'SecurePass123!',
          name: 'Golden Test User'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('name', 'Golden Test User');
      
      // Verify auth cookie is set
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('boardroom_token=');
      expect(setCookie[0]).toContain('HttpOnly');
      expect(setCookie[0]).toContain('SameSite=Lax');
    });

    it('SCENARIO 1.2: should reject duplicate email registration', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: uniqueEmail, // Same email as above
          password: 'AnotherPass123!',
          name: 'Duplicate User'
        });

      expect(response.status).toBe(409);
      expect(response.body).toHaveProperty('error', 'validation_failed');
      expect(response.body.details[0]).toHaveProperty('field', 'email');
      expect(response.body.details[0]).toHaveProperty('message', 'Email already registered');
    });

    it('SCENARIO 1.3: should validate email format', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email-format',
          password: 'Password123!',
          name: 'Invalid Email User'
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error', 'validation_failed');
    });

    it('SCENARIO 1.4: should validate password strength', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: `weak-pass-${Date.now()}@test.com`,
          password: 'weak',
          name: 'Weak Password User'
        });

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error', 'validation_failed');
    });
  });

  // SCENARIO 2: User login and session management
  describe('User Login Flow', () => {
    const testEmail = `golden-login-${Date.now()}@boardroom.test`;
    const testPassword = 'LoginTest123!';
    let authCookie: string;

    beforeAll(async () => {
      // Create test user first
      await request(app)
        .post('/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          name: 'Login Test User'
        });
    });

    it('SCENARIO 2.1: should login with valid credentials', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testEmail,
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('name', 'Login Test User');
      
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toContain('boardroom_token=');
      authCookie = setCookie[0];
    });

    it('SCENARIO 2.2: should reject invalid password', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword123!'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
      expect(response.body).toHaveProperty('message', 'Invalid email or password');
    });

    it('SCENARIO 2.3: should reject non-existent email', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'nonexistent@golden-test.com',
          password: 'Password123!'
        });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
    });

    it('SCENARIO 2.4: should get user info with valid session', async () => {
      const response = await request(app)
        .get('/auth/me')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('email', testEmail);
      expect(response.body).toHaveProperty('name', 'Login Test User');
    });

    it('SCENARIO 2.5: should reject unauthenticated /auth/me request', async () => {
      const response = await request(app)
        .get('/auth/me');

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'unauthorized');
    });
  });