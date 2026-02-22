/**
 * qaos Database Schema — Test-First Architecture (PostgreSQL)
 */

import { pgTable, text, integer, boolean, timestamp, bigserial, jsonb } from 'drizzle-orm/pg-core'

// ─── Users & Auth ───────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

// ─── Sessions table removed (Using JWT) ──────────────────────────────────────
export const userPreferences = pgTable('user_preferences', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id)
    .unique(),
  theme: text('theme').notNull().default('light'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

// ─── Tests ──────────────────────────────────────────────────────────────────

export const tests = pgTable('tests', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('New Test'),
  url: text('url'),
  model: text('model'),
  executionMode: text('execution_mode').notNull().default('single'),
  testAccountId: text('test_account_id'),
  userId: integer('user_id').notNull().default(1),
  status: text('status').default('idle'),
  headless: boolean('headless').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const testAccounts = pgTable('test_accounts', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  accountKey: text('account_key').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const testMessages = pgTable('test_messages', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  testId: text('test_id')
    .notNull()
    .references(() => tests.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  screenshotPath: text('screenshot_path'),
  userId: integer('user_id').notNull().default(1),
  excluded: boolean('excluded').default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const testRecords = pgTable('test_records', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  testId: text('test_id').notNull(),
  sourceFile: text('source_file').notNull(),
  recordIndex: integer('record_index').notNull(),
  title: text('title'),
  priority: text('priority'),
  description: text('description'),
  normalizedRecord: jsonb('normalized_record').notNull(),
  rawRecord: jsonb('raw_record').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

// ─── Test Suites (many-to-many) ─────────────────────────────────────────────

export const testSuites = pgTable('test_suites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const testSuiteTests = pgTable('test_suite_tests', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  suiteId: text('suite_id')
    .notNull()
    .references(() => testSuites.id, { onDelete: 'cascade' }),
  testId: text('test_id')
    .notNull()
    .references(() => tests.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})
