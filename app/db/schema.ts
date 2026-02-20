/**
 * qaos Database Schema — Chat-First Architecture
 *
 * Sessions = chat threads. Messages = user prompts, agent thoughts, screenshots.
 * Multi-tenancy prep: user_id on all records (defaults to 1 for v1.0).
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Sessions (Chat Threads) ───────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // nanoid
  title: text("title").notNull().default("New Chat"),
  url: text("url"), // target URL being tested
  model: text("model"),
  userId: integer("user_id").notNull().default(1), // multi-tenant prep
  status: text("status", { enum: ["idle", "running", "stopped"] }).default("idle"),
  headless: integer("headless", { mode: "boolean" }).default(true),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Messages ───────────────────────────────────────────────────────────────

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  role: text("role", { enum: ["user", "agent", "system"] }).notNull(),
  content: text("content").notNull(),
  screenshotPath: text("screenshot_path"), // relative path to screenshot file
  userId: integer("user_id").notNull().default(1), // multi-tenant prep
  excluded: integer("excluded", { mode: "boolean" }).default(false), // for curating test cases
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

// ─── Config (Key-Value System Settings) ─────────────────────────────────────

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
