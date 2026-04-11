// Golden Test Scenarios: Memory Lifecycle (Continued)
// Additional scenarios covering memory updates, archiving, search, and filtering.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: Memory Lifecycle (Continued)', () => {
  let authCookie: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Create a test user for all scenarios
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `memory-cont-${Date.now()}@boardroom.test`,
        password: 'MemoryTest123!',
        name: 'Memory Test User'
      });

    authCookie = response.headers['set-cookie'][0];
  });

  // Continue SCENARIO 12: Basic memory CRUD operations
  describe('Basic Memory CRUD Operations (Continued)', () => {
    let memoryId: string;
    const uniqueContent = `Test memory for update - ${Date.now()}`;

    beforeAll(async () => {
      // Create a memory first
      const response = await request(app)
        .post('/entities/memories')
        .set('Cookie', authCookie)
        .send({
          content: uniqueContent,
          domain: 'test',
          tags: ['initial']
        });
      memoryId = response.body.id;
    });

    it('SCENARIO 12.4: should update memory', async () => {
      const response = await request(app)
        .patch(`/entities/memories/${memoryId}`)
        .set('Cookie', authCookie)
        .send({
          content: `${uniqueContent} - Updated`,
          tags: ['initial', 'updated'],
          priority: 'high'
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toContain('Updated');
      expect(response.body.tags).toContain('updated');
      expect(response.body.priority).toBe('high');
    });

    it('SCENARIO 12.5: should archive memory', async () => {
      const response = await request(app)
        .post(`/entities/memories/${memoryId}/archive`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('SCENARIO 12.6: should not show archived memory in default list', async () => {
      const response = await request(app)
        .get('/entities/memories')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.some((m: any) => m.id === memoryId)).toBe(false);
    });
  });

  // SCENARIO 13: Memory search and filtering
  describe('Memory Search and Filtering', () => {
    let memoryId1: string;
    let memoryId2: string;
    const searchTerm = `search-test-${Date.now()}`;

    beforeAll(async () => {
      // Create test memories
      const mem1 = await request(app)
        .post('/entities/memories')
        .set('Cookie', authCookie)
        .send({
          content: `${searchTerm} memory about product launch`,
          domain: 'product',
          tags: ['launch', 'feature']
        });
      memoryId1 = mem1.body.id;

      const mem2 = await request(app)
        .post('/entities/memories')
        .set('Cookie', authCookie)
        .send({
          content: `Another memory with ${searchTerm} keyword`,
          domain: 'marketing',
          tags: ['campaign', 'strategy']
        });
      memoryId2 = mem2.body.id;

      // Create memory without search term
      await request(app)
        .post('/entities/memories')
        .set('Cookie', authCookie)
        .send({
          content: 'Unrelated memory content',
          domain: 'operations',
          tags: ['process', 'efficiency']
        });
    });

    it('SCENARIO 13.1: should search memories by keyword', async () => {
      const response = await request(app)
        .get(`/entities/memories/search?q=${encodeURIComponent(searchTerm)}`)
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2);
      
      const memoryIds = response.body.map((m: any) => m.id);
      expect(memoryIds).toContain(memoryId1);
      expect(memoryIds).toContain(memoryId2);
    });

    it('SCENARIO 13.2: should filter memories by domain', async () => {
      const response = await request(app)
        .get('/entities/memories?domain=product')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.some((m: any) => m.id === memoryId1)).toBe(true);
      expect(response.body.some((m: any) => m.id === memoryId2)).toBe(false);
    });

    it('SCENARIO 13.3: should filter memories by tag', async () => {
      const response = await request(app)
        .get('/entities/memories?tag=launch')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body.some((m: any) => m.id === memoryId1)).toBe(true);
    });

    it('SCENARIO 13.4: should handle empty search results', async () => {
      const response = await request(app)
        .get('/entities/memories/search?q=nonexistentkeyword12345')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });
  });
});