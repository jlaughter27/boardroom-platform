// Lane G item 2 — how many reverse-proxy hops BoardRoom trusts for req.ip.
//
// Express derives req.ip from X-Forwarded-For only for the hops it trusts.
// Railway terminates TLS at exactly ONE edge proxy, which appends the real
// client address as the right-most XFF entry, so production trusts 1 hop
// (B-104: without it every per-IP limiter is one site-wide bucket). Anywhere
// BoardRoom is reached directly (local dev, CI, tests, a private-network
// caller) there is no such proxy, and trusting a hop would let the client's
// own XFF value pick the rate-limit key — a fresh login bucket per request.
//
//   TRUST_PROXY_HOPS unset → 1 when NODE_ENV=production, else 0 (off)
//   TRUST_PROXY_HOPS=0     → off: req.ip is the socket peer
//   TRUST_PROXY_HOPS=N     → trust N hops (only if N proxies really sit in front)
//
// `true` / CIDR / named values are refused on purpose: `trust proxy = true`
// trusts every hop, i.e. the left-most (client-written) XFF entry.

const MAX_HOPS = 10;

export function resolveTrustProxy(env: Record<string, string | undefined> = process.env): number | false {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw === undefined || raw === '') {
    return env.NODE_ENV === 'production' ? 1 : false;
  }
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS must be an integer between 0 and ${MAX_HOPS} (got "${raw}")`);
  }
  const hops = Number(raw);
  return hops === 0 ? false : hops;
}
