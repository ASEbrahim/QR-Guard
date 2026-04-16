/**
 * Authentication and authorization middleware.
 * Instructors do NOT get device binding — only students have device_fingerprint in the schema.
 */

/**
 * Requires an authenticated session. Returns 401 if not logged in.
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Requires the authenticated user to have a specific role.
 * Must be used after requireAuth.
 * @param {'student'|'instructor'} role
 */
export function requireRole(role) {
  return (req, res, next) => {
    if (req.session?.role !== role) {
      return res.status(403).json({ error: `Requires ${role} role` });
    }
    next();
  };
}
