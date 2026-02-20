import type { Route } from "./+types/api.settings.$sessionId";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";

export async function action({ request, params }: Route.ActionArgs) {
  const { sessionId } = params;
  const db = getDb();
  const formData = await request.formData();
  
  const headless = formData.get("headless") === "true";

  // Update session
  db.update(schema.sessions)
    .set({ headless: headless })
    .where(eq(schema.sessions.id, sessionId))
    .run();

  // Force immediate browser relaunch/update
  const { browserManager } = await import("~/services/browser.server");
  try {
    // This will trigger the restart logic if mode changed
    await browserManager.getPage(sessionId, undefined, headless);
  } catch (err) {
    console.error("Failed to relaunch browser:", err);
  }

  return new Response(JSON.stringify({ success: true, headless }), {
    headers: { "Content-Type": "application/json" },
  });
}
