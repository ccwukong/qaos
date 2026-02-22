import { type RouteConfig, index, route } from '@react-router/dev/routes'

// Routing policy: config-based routing only.
// Keep all route registrations in this manifest; route files are modules, not auto-routed.

export default [
  index('handlers/pages/home.tsx'),
  route('login', 'handlers/pages/login.tsx'),
  route('register', 'handlers/pages/register.tsx'),
  route('test/:sessionId', 'handlers/pages/test-session.tsx'),
  route('settings', 'handlers/pages/settings.tsx'),
  route('replay', 'handlers/pages/replay.tsx'),
  route('suites', 'handlers/pages/suites.tsx'),
  route('api/logout', 'handlers/api/logout.tsx'),
  route('api/test/:sessionId', 'handlers/api/test-session.tsx'),
  route('api/executor/status', 'handlers/api/executor-status.tsx'),
  route('api/executor/heartbeat', 'handlers/api/executor-heartbeat.tsx'),
  route('api/executor/connect', 'handlers/api/executor-connect.tsx'),
  route('api/executor/result', 'handlers/api/executor-result.tsx'),
  route('api/export/:sessionId', 'handlers/api/export-session.tsx'),
  route('api/replay', 'handlers/api/replay.tsx'),
  route('api/stop/:sessionId', 'handlers/api/stop-session.tsx'),
  route('api/settings/:sessionId', 'handlers/api/settings-session.tsx'),
  route('api/message', 'handlers/api/message.tsx'),
] satisfies RouteConfig
