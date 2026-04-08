import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/index';

beforeAll(() => {
  // Set API key for auth middleware tests
  process.env.OMNIMIND_API_KEY = 'dev-api-key-change-in-production';
});

describe('Health endpoint', () => {
  it('GET /health returns 200 with expected shape', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('service', 'omnimind-api');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('dbConnected');
  });

  it('Non-health endpoint without API key returns 401', async () => {
    const res = await request(app).get('/memories');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthorized');
  });

  it('Non-health endpoint with valid API key passes auth', async () => {
    const res = await request(app)
      .get('/memories')
      .set('x-api-key', 'dev-api-key-change-in-production');
    // Should get 404 (route not yet mounted), not 401
    expect(res.status).not.toBe(401);
  });
});
