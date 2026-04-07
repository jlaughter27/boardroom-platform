// E2E tests run against built services
// Requires: docker-compose up (postgres + both services)
// OR: both services running locally with test database

export const OMNIMIND_URL = process.env.OMNIMIND_URL || 'http://localhost:3333';
export const BOARDROOM_URL = process.env.BOARDROOM_URL || 'http://localhost:3001';

export async function waitForServices(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const [omni, board] = await Promise.all([
        fetch(`${OMNIMIND_URL}/health`),
        fetch(`${BOARDROOM_URL}/health`),
      ]);
      if (omni.ok && board.ok) return;
    } catch {
      // Services not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Services did not become healthy within timeout');
}

export async function registerTestUser(): Promise<{
  userId: string;
  cookie: string;
}> {
  const email = `test-${Date.now()}@boardroom-e2e.test`;
  const res = await fetch(`${BOARDROOM_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!', name: 'E2E Test User' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Registration failed: ${res.status} — ${body}`);
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const body = await res.json() as { userId: string };
  return { userId: body.userId, cookie: setCookie };
}

export function authedFetch(url: string, cookie: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...options.headers,
    },
  });
}
