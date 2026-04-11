// Golden Test Scenarios: Decision Sessions
// Comprehensive scenarios covering session creation, persona dispatch,
// synthesis, questionnaire, and export.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: Decision Sessions', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Create a test user for all scenarios
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `session-${Date.now()}@boardroom.test`,
        password: 'SessionTest123!',
        name: 'Session Test User'
      });

    authCookie = response.headers['set-cookie'][0];
    userId = response.body.userId;
  });

  afterAll(() => {
    // Clean up any test data if needed
  });

  // SCENARIO 14: Session creation and basic operations
  describe('Session Creation and Basic Operations', () => {
    let sessionId: string;

    it('SCENARIO 14.1: should create a decision session', async () => {
      const response = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send({
          question: 'Should we expand into the European market this quarter?',
          mode: 'decide'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body.question).toContain('European market');
      expect(response.body.mode).toBe('decide');
      expect(response.body.personasToFire).toBeDefined();
      expect(response.body.includesCEO).toBe(true);
      sessionId = response.body.sessionId;
    });

    it('SCENARIO 14.2: should retrieve created session', async () => {
      const response = await request(app)
        .get(`/sessions/${sessionId}`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(sessionId);
      expect(response.body.question).toContain('European market');
      expect(response.body.mode).toBe('decide');
    });

    it('SCENARIO 14.3: should list sessions including the new one', async () => {
      const response = await request(app)
        .get('/sessions')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.items).toBeDefined();
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.some((s: any) => s.id === sessionId)).toBe(true);
    });
  });
});