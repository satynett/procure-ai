// rateLimit.js
// Minimal in-memory rate limiter with zero extra dependencies - enough to
// stop naive brute-forcing of the demo login in this prototype. Keyed by
// IP + route. For a real deployment this would be replaced by a proper
// limiter backed by Redis/etc. (see README "Notes for production evolution").

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        message: `Too many attempts. Try again in ${retryAfterSec}s.`,
      });
    }
    next();
  };
}
