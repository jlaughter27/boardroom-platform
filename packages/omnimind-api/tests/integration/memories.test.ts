// Integration tests for Memory CRUD routes.
// Requires a running PostgreSQL database with DATABASE_URL set.
// These tests will be skipped if DATABASE_URL is not configured.
// To run: DATABASE_URL=postgresql://... npx vitest run tests/integration/memories.test.ts
// Known skip reason: No test database in default CI/local — intentional guard, not a bug.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/index';

const API_KEY = 'dev-api-key-change-in-production';
const USER_A = 'test-user-1';
const USER_B = 'test-user-2';

const validMemory = {
  title: 'Test Memory',
  content: 'This is a test memory for integration testing.',
  domain: 'business',
  sourceType: 'MANUAL',
  tags: ['test', 'integration'],
  memoryClass: 'SEMANTIC',
  importance: 0.7,
  confidence: 'HIGH',
};

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('Memory CRUD routes (integration)', () => {
  let createdMemoryId: string;

  it('POST /memories with valid input returns 201 with { id, status: "created" }', async () => {
    const res = await request(app)
      .post('/memories')
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A)
      .send(validMemory);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('status', 'created');
    expect(res.body).toHaveProperty('validation');
    expect(res.body.validation).toHaveProperty('syncPassed', true);
    expect(res.body.validation).toHaveProperty('errors');
    expect(res.body.validation.errors).toHaveLength(0);

    createdMemoryId = res.body.id;
  });

  it('POST /memories with missing title returns 422', async () => {
    const res = await request(app)
      .post('/memories')
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A)
      .send({
        content: 'No title provided',
        domain: 'business',
        sourceType: 'MANUAL',
      });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('error', 'validation_failed');
    expect(res.body).toHaveProperty('details');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('GET /memories/:id returns 200 with full memory object', async () => {
    const res = await request(app)
      .get(`/memories/${createdMemoryId}`)
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', createdMemoryId);
    expect(res.body).toHaveProperty('title', validMemory.title);
    expect(res.body).toHaveProperty('content', validMemory.content);
    expect(res.body).toHaveProperty('domain', validMemory.domain);
    expect(res.body).toHaveProperty('userId', USER_A);
    expect(res.body).toHaveProperty('status', 'DRAFT');
  });

  it('GET /memories (list) returns 200 with { items, total, offset, limit }', async () => {
    const res = await request(app)
      .get('/memories')
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('offset');
    expect(res.body).toHaveProperty('limit');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /memories/:id returns 200 with updated memory', async () => {
    const res = await request(app)
      .patch(`/memories/${createdMemoryId}`)
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A)
      .send({ title: 'Updated Test Memory' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', createdMemoryId);
    expect(res.body).toHaveProperty('title', 'Updated Test Memory');
    expect(res.body).toHaveProperty('version');
    expect(res.body.version).toBeGreaterThanOrEqual(2);
  });

  it('User isolation — create with user A, GET with user B returns 404', async () => {
    const res = await request(app)
      .get(`/memories/${createdMemoryId}`)
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_B);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'not_found');
  });

  it('DELETE /memories/:id returns 200 with { id, status: "archived" }', async () => {
    const res = await request(app)
      .delete(`/memories/${createdMemoryId}`)
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', createdMemoryId);
    expect(res.body).toHaveProperty('status', 'archived');
  });

  it('GET /memories/:id after delete returns 404', async () => {
    const res = await request(app)
      .get(`/memories/${createdMemoryId}`)
      .set('x-api-key', API_KEY)
      .set('x-user-id', USER_A);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'not_found');
  });
});
