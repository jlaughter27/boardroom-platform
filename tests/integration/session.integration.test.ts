// Integration tests for session management and persona orchestration
// Tests session creation, persona dispatch, synthesis, and extraction

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-e2e';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-e2e';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';
process.env.MOCK_LLM = 'true';

// Test session data
const TEST_SESSION = {
  question: 'Should we expand into the European market this quarter?',
  mode: 'Decide'
};

const TEST_USER = {
  email: 'test-session-integration@boardroom.test',
  password: 'TestPassword123!',
  name: 'Session Test User'
};

describe('Session Management Integration Tests', () => {
  let authCookie: string;
  let userId: string;
  let sessionId: string;

  beforeAll(async () => {
    // Register test user
    const registerResponse = await request(app)
      .post('/auth/register')
      .send(TEST_USER);

    expect(registerResponse.status).toBe(201);
    authCookie = registerResponse.headers['set-cookie'][0];
    userId = registerResponse.body.userId;
  });

  beforeEach(() => {
    // Reset session ID before each test
    sessionId = '';
  });

  describe('Session CRUD Operations', () => {
    it('POST /sessions creates a new session', async () => {
      const response = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('sessionId');
      expect(response.body).toHaveProperty('question', TEST_SESSION.question);
      expect(response.body).toHaveProperty('mode', TEST_SESSION.mode);
      expect(response.body).toHaveProperty('personasToFire');
      expect(response.body).toHaveProperty('includesCEO', true);

      sessionId = response.body.sessionId;
    });

    it('GET /sessions/:id retrieves created session', async () => {
      // First create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      const response = await request(app)
        .get(`/sessions/${newSessionId}`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', newSessionId);
      expect(response.body).toHaveProperty('question', TEST_SESSION.question);
      expect(response.body).toHaveProperty('mode', TEST_SESSION.mode);
      expect(response.body).toHaveProperty('personaResponses');
      expect(response.body).toHaveProperty('ceoSynthesis');
    });

    it('GET /sessions/:id returns 404 for non-existent session', async () => {
      const response = await request(app)
        .get('/sessions/nonexistent-session')
        .set('Cookie', authCookie);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'not_found');
    });

    it('GET /sessions lists user sessions', async () => {
      // Create a session first
      await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);

      const response = await request(app)
        .get('/sessions')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('offset', 0);
      expect(response.body).toHaveProperty('limit', 20);
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.total).toBeGreaterThan(0);
    });
  });

  describe('Session Orchestration', () => {
    it('POST /sessions/:id/dispatch triggers persona responses (mocked)', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      // Mock dispatch (with MOCK_LLM=true)
      const response = await request(app)
        .post(`/sessions/${newSessionId}/dispatch`)
        .set('Cookie', authCookie);

      // With MOCK_LLM=true, should return a mocked response
      expect([200, 201]).toContain(response.status);
    });

    it('POST /sessions/:id/check-ambiguity returns sufficiency score', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      const response = await request(app)
        .post(`/sessions/${newSessionId}/check-ambiguity`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('sufficiency');
      expect(response.body).toHaveProperty('ambiguity');
      expect(response.body).toHaveProperty('questions');
    });

    it('POST /sessions/:id/extract-memories returns memory proposals', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      const response = await request(app)
        .post(`/sessions/${newSessionId}/extract-memories`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('proposals');
      expect(Array.isArray(response.body.proposals)).toBe(true);
    });
  });

  describe('Session Export', () => {
    it('GET /sessions/:id/export returns session data', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      const response = await request(app)
        .get(`/sessions/${newSessionId}/export`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('session');
      expect(response.body).toHaveProperty('personas');
      expect(response.body).toHaveProperty('synthesis');
    });

    it('GET /sessions/:id/export?format=pdf returns 501 (not implemented)', async () => {
      // Create a session
      const createResponse = await request(app)
        .post('/sessions')
        .set('Cookie', authCookie)
        .send(TEST_SESSION);
      
      const newSessionId = createResponse.body.sessionId;

      const response = await request(app)
        .get(`/sessions/${newSessionId}/export?format=pdf`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(501);
      expect(response.body).toHaveProperty('error', 'not_implemented');
    });
  });
});
