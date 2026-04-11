// Golden Test Scenarios: Entity Management
// Comprehensive scenarios covering Goals, Projects, Tasks, People, Decisions,
// Commitments, and Outcome Reviews.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: Entity Management', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Create a test user for all scenarios
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `entity-mgmt-${Date.now()}@boardroom.test`,
        password: 'EntityMgmt123!',
        name: 'Entity Management Test User'
      });

    authCookie = response.headers['set-cookie'][0];
    userId = response.body.userId;
  });

  afterAll(() => {
    // Clean up any test data if needed
  });

  // SCENARIO 15: People management
  describe('People Management', () => {
    let personId: string;

    it('SCENARIO 15.1: should create a person', async () => {
      const response = await request(app)
        .post('/entities/people')
        .set('Cookie', authCookie)
        .send({
          name: 'John Doe',
          role: 'Product Manager',
          organization: 'Tech Corp',
          relationshipStrength: 0.8,
          lastContact: '2024-03-15',
          notes: 'Key decision maker for Q2 project'
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('John Doe');
      expect(response.body.role).toBe('Product Manager');
      personId = response.body.id;
    });

    it('SCENARIO 15.2: should list people', async () => {
      const response = await request(app)
        .get('/entities/people')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((p: any) => p.id === personId)).toBe(true);
    });
  });
});