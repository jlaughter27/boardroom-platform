// Golden Test Scenarios: User Onboarding & Profile Management
// Comprehensive scenarios covering user onboarding, profile creation, updates,
// and dashboard customization.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../packages/boardroom-ai/server/src/index';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-golden';
process.env.OMNIMIND_API_URL = 'http://localhost:3334';
process.env.OMNIMIND_API_KEY = 'test-api-key-golden';
process.env.ANTHROPIC_API_KEY = 'mock-anthropic-key';
process.env.NODE_ENV = 'test';

describe('Golden Test Scenarios: User Onboarding & Profile Management', () => {
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Create a test user for all scenarios
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `onboarding-${Date.now()}@boardroom.test`,
        password: 'OnboardTest123!',
        name: 'Onboarding Test User'
      });

    authCookie = response.headers['set-cookie'][0];
    userId = response.body.userId;
  });

  afterAll(() => {
    // Clean up any test data if needed
  });

  // SCENARIO 7: Complete user onboarding flow
  describe('User Onboarding Flow', () => {
    it('SCENARIO 7.1: should retrieve empty profile for new user', async () => {
      const response = await request(app)
        .get('/entities/profile')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('userId', userId);
      // New user should have minimal profile data
      expect(response.body.onboardingComplete).toBe(false);
    });

    it('SCENARIO 7.2: should update user profile with onboarding data', async () => {
      const profileUpdate = {
        role: 'Product Manager',
        industry: 'Technology',
        decisionFrequency: 'weekly',
        riskProfile: {
          financial: 0.7,
          technical: 0.5,
          people: 0.8,
          strategic: 0.9
        },
        valueHierarchy: ['transparency', 'efficiency', 'innovation'],
        onboardingComplete: true
      };

      const response = await request(app)
        .patch('/entities/profile')
        .set('Cookie', authCookie)
        .send(profileUpdate);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('role', 'Product Manager');
      expect(response.body).toHaveProperty('industry', 'Technology');
      expect(response.body).toHaveProperty('onboardingComplete', true);
      expect(response.body.riskProfile).toHaveProperty('financial', 0.7);
    });

    it('SCENARIO 7.3: should validate profile update data', async () => {
      const invalidUpdate = {
        riskProfile: {
          financial: 2.0, // Invalid: should be between 0 and 1
          technical: 0.5,
          people: 0.8,
          strategic: 0.9
        }
      };

      const response = await request(app)
        .patch('/entities/profile')
        .set('Cookie', authCookie)
        .send(invalidUpdate);

      expect(response.status).toBe(422);
      expect(response.body).toHaveProperty('error', 'validation_failed');
    });

    it('SCENARIO 7.4: should persist profile changes', async () => {
      // First update
      await request(app)
        .patch('/entities/profile')
        .set('Cookie', authCookie)
        .send({
          role: 'Updated Role',
          onboardingComplete: true
        });

      // Then retrieve to verify persistence
      const response = await request(app)
        .get('/entities/profile')
        .set('Cookie', authCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('role', 'Updated Role');
      expect(response.body).toHaveProperty('onboardingComplete', true);
    });
  });