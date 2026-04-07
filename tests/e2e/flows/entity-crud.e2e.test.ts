import { describe, it, expect, beforeAll } from 'vitest';
import { BOARDROOM_URL, waitForServices, registerTestUser, authedFetch } from '../setup';

const ENTITY_TYPES = [
  {
    name: 'goals',
    createPayload: { title: 'E2E Test Goal', description: 'Achieve 100% test coverage', status: 'active' },
    updatePayload: { title: 'E2E Test Goal — Updated' },
  },
  {
    name: 'projects',
    createPayload: { title: 'E2E Test Project', description: 'Build the E2E suite', status: 'active' },
    updatePayload: { title: 'E2E Test Project — Updated' },
  },
  {
    name: 'tasks',
    createPayload: { title: 'E2E Test Task', description: 'Write entity CRUD tests', status: 'pending' },
    updatePayload: { title: 'E2E Test Task — Updated' },
  },
  {
    name: 'people',
    createPayload: { name: 'E2E Test Person', role: 'QA Engineer', relationship: 'colleague' },
    updatePayload: { name: 'E2E Test Person — Updated' },
  },
];

describe('Entity CRUD', () => {
  let cookie: string;

  beforeAll(async () => {
    await waitForServices();
    const user = await registerTestUser();
    cookie = user.cookie;
  });

  for (const entity of ENTITY_TYPES) {
    describe(entity.name, () => {
      let entityId: string;

      it(`creates a ${entity.name} entity`, async () => {
        const res = await authedFetch(`${BOARDROOM_URL}/${entity.name}`, cookie, {
          method: 'POST',
          body: JSON.stringify(entity.createPayload),
        });
        expect(res.status).toBe(201);
        const body = await res.json() as { id: string };
        expect(body.id).toBeDefined();
        entityId = body.id;
      });

      it(`lists ${entity.name} including the new entity`, async () => {
        const res = await authedFetch(`${BOARDROOM_URL}/${entity.name}`, cookie);
        expect(res.status).toBe(200);
        const body = await res.json() as Array<{ id: string }>;
        expect(Array.isArray(body)).toBe(true);
        expect(body.some(e => e.id === entityId)).toBe(true);
      });

      it(`updates the ${entity.name} entity`, async () => {
        const res = await authedFetch(`${BOARDROOM_URL}/${entity.name}/${entityId}`, cookie, {
          method: 'PATCH',
          body: JSON.stringify(entity.updatePayload),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        const updatedField = Object.keys(entity.updatePayload)[0];
        expect(body[updatedField]).toBe(Object.values(entity.updatePayload)[0]);
      });

      it(`deletes the ${entity.name} entity`, async () => {
        const res = await authedFetch(`${BOARDROOM_URL}/${entity.name}/${entityId}`, cookie, {
          method: 'DELETE',
        });
        expect([200, 204]).toContain(res.status);
      });

      it(`no longer lists the deleted ${entity.name} entity`, async () => {
        const res = await authedFetch(`${BOARDROOM_URL}/${entity.name}`, cookie);
        expect(res.status).toBe(200);
        const body = await res.json() as Array<{ id: string }>;
        expect(body.some(e => e.id === entityId)).toBe(false);
      });
    });
  }
});
