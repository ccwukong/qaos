/**
 * Index route — creates a new chat session and redirects to it.
 */

import { redirect } from "react-router";
import { getDb, schema } from "~/db/db.server";

function nanoid(size = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < size; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export async function loader() {
  const db = getDb();
  const id = nanoid();

  const defaultHeadless = process.env.HEADLESS !== "false"; // default to true (headless) unless explicit "false"

  db.insert(schema.sessions)
    .values({ id, title: "New Chat", headless: defaultHeadless })
    .run();

  return redirect(`/chat/${id}`);
}

export default function Index() {
  return null;
}
