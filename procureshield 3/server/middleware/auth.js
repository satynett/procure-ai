// auth.js
// Demo-grade bearer-token check. Previously the frontend was the ONLY thing
// stopping an unauthenticated caller from hitting the API directly (every
// route worked from curl with zero credentials). This middleware closes that
// gap: every /api/* route except /api/auth/login and /api/health now
// requires `Authorization: Bearer <token>`, using the same static demo
// session token issued at login.
//
// This is still NOT production authentication (no expiry, no per-user
// sessions, no refresh) - see README "Notes for production evolution" - but
// it means the backend itself enforces access control instead of relying on
// the client to behave.

const DEMO_TOKEN = "demo-session-token";

const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/health"]);

export function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || token !== DEMO_TOKEN) {
    return res.status(401).json({
      message: "Unauthorized. Sign in and include the demo session token as a Bearer token.",
    });
  }
  return next();
}

export { DEMO_TOKEN };
