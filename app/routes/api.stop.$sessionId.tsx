import type { Route } from "./+types/api.stop.$sessionId";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";

export async function action({ params }: Route.ActionArgs) {
  const { sessionId } = params;
  const db = getDb();

  // Update session status to "stopped"
  console.log(`[API] Stopping session ${sessionId}...`);
  db.update(schema.sessions)
    .set({ status: "stopped" })
    .where(eq(schema.sessions.id, sessionId))
    .run();
  console.log(`[API] Session ${sessionId} marked as stopped.`);

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
