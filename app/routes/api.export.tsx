/**
 * API: Export session as a reusable test case JSON.
 *
 * GET /api/export/:sessionId → downloads a JSON test script
 */

import type { Route } from "./+types/api.export";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";

export async function loader({ params }: Route.LoaderArgs) {
  const { sessionId } = params;
  const db = getDb();

  const session = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();

  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const messages = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .all();

  // Extract user prompts for Smart Replay
  const steps: Array<{ action: string; detail: string }> = [];
  for (const msg of messages) {
    // Only include user messages that are NOT excluded
    if (msg.role === "user" && !msg.excluded) {
      steps.push({ action: "prompt", detail: msg.content });
    }
  }

  const testCase = {
    name: session.title || "Untitled Test",
    url: session.url || "",
    model: session.model,
    createdAt: session.createdAt,
    steps,
    messages: messages.map((m: { role: string; content: string; createdAt: string }) => ({
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    })),
  };

  const filename = `qaos-test-${sessionId.slice(0, 8)}.json`;

  return new Response(JSON.stringify(testCase, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
