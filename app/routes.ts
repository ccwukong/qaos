import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("chat/:sessionId", "routes/chat.tsx"),
  route("settings", "routes/settings.tsx"),
  route("replay", "routes/replay.tsx"),
  route("api/chat/:sessionId", "routes/api.chat.tsx"),
  route("api/export/:sessionId", "routes/api.export.tsx"),
  route("api/replay", "routes/api.replay.tsx"),
  route("api/stop/:sessionId", "routes/api.stop.$sessionId.tsx"),
  route("api/settings/:sessionId", "routes/api.settings.$sessionId.tsx"),
  route("api/message", "routes/api.message.tsx"),
] satisfies RouteConfig;
