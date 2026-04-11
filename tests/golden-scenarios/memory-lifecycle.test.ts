// Golden Test Scenarios: Memory Lifecycle
// Comprehensive scenarios covering memory creation, retrieval, search,
// linking, archiving, and extraction.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: Memory Lifecycle', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Create a test user for all scenarios
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `memory-${Date.now()}@boardroom.test`,
        password: 'MemoryTest123!',
        name: 'Memory Test User'
      });

    authCookie = response.headers['set-cookie'][0];
    userId = response.body.userId;
  });

  afterAll(() => {
    // Clean up any test data if needed
  });

  // SCENARIO 12: Basic memory CRUD operations
  describe('Basic Memory CRUD Operations', () => {
    let memoryId: string;
    const uniqueContent = `Q2 revenue target: $5M (test-${Date.now()})`;

    it('SCENARIO 12.1: should create a memory', async () => {
      const response = await request(app)
        .post('/entities/memories')
        .set('Cookie', authCookie)
        .send({
          content: uniqueContent,
          domain: 'business',
          tags: ['revenue', 'target', 'quarterly'],
          priority: 'medium'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.content).toContain('Q2 revenue target');
      expect(response.body.domain).toBe('business');
      expect(response.body.tags).toContain('revenue');
      memoryId = response.body.id;
    });

    it('SCENARIO 12.2: should retrieve created memory', async () => {
      const response = await request(app)
        .get(`/entities/memories/${memoryId}`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(memoryId);
      expect(response.body.content).toContain('Q2 revenue target');
      expect(response.body.domain).toBe('business');
    });

    it('SCENARIO 12.3: should list memories including the new one', async () => {
      const response = await request(app)
        .get('/entities/memories')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((m: any) => m.id === memoryId)).toBe(true);
    });
  });
});