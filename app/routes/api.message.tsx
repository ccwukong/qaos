import type { ActionFunctionArgs } from "react-router";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { messageId, excluded } = await request.json();

  if (typeof messageId !== "number" || typeof excluded !== "boolean") {
    return new Response("Invalid payload", { status: 400 });
  }

  const db = getDb();
  
  db.update(schema.messages)
    .set({ excluded: excluded ? 1 : 0 }) // 1 = true, 0 = false (SQLite integer)
    .where(eq(schema.messages.id, messageId))
    .run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
