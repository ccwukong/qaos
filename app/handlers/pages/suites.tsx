import { useState } from 'react'
import { Form, useLoaderData, useNavigation } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { requireUser } from '~/services/auth.server'
import { getDb, schema } from '~/db/db.server'
import { eq, desc, and } from 'drizzle-orm'

function makeId(size = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < size; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const db = await getDb()

  const suitesRows = await db
    .select({
      suite: schema.testSuites,
      test: schema.tests,
      linkId: schema.testSuiteTests.id,
    })
    .from(schema.testSuites)
    .where(eq(schema.testSuites.userId, user.id))
    .leftJoin(schema.testSuiteTests, eq(schema.testSuiteTests.suiteId, schema.testSuites.id))
    .leftJoin(schema.tests, eq(schema.tests.id, schema.testSuiteTests.testId))
    .orderBy(desc(schema.testSuites.createdAt))

  const suitesMap = new Map<string, any>()
  for (const row of suitesRows) {
    if (!suitesMap.has(row.suite.id)) {
      suitesMap.set(row.suite.id, { ...row.suite, tests: [] })
    }
    if (row.test) {
      suitesMap.get(row.suite.id).tests.push({ ...row.test, linkId: row.linkId })
    }
  }
  const suites = Array.from(suitesMap.values())

  const availableTests = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.userId, user.id))
    .orderBy(desc(schema.tests.createdAt))

  return { suites, availableTests }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request)
  const db = await getDb()
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'create_suite') {
    const name = formData.get('name') as string
    const description = (formData.get('description') as string) || ''
    if (name) {
      await db.insert(schema.testSuites).values({
        id: makeId(),
        name,
        description,
        userId: user.id,
      })
    }
  }

  if (intent === 'delete_suite') {
    const suiteId = formData.get('suiteId') as string
    if (suiteId) {
      // test_suite_tests should cascade on delete
      await db
        .delete(schema.testSuites)
        .where(and(eq(schema.testSuites.id, suiteId), eq(schema.testSuites.userId, user.id)))
    }
  }

  if (intent === 'add_test') {
    const suiteId = formData.get('suiteId') as string
    const testId = formData.get('testId') as string
    if (suiteId && testId) {
      // Verify suite belongs to user
      const suiteRow = await db
        .select()
        .from(schema.testSuites)
        .where(and(eq(schema.testSuites.id, suiteId), eq(schema.testSuites.userId, user.id)))
        .limit(1)
      if (suiteRow.length > 0) {
        await db.insert(schema.testSuiteTests).values({
          suiteId,
          testId,
        })
      }
    }
  }

  if (intent === 'remove_test') {
    const linkIdStr = formData.get('linkId') as string
    if (linkIdStr) {
      const linkId = parseInt(linkIdStr, 10)
      if (!isNaN(linkId)) {
        await db.delete(schema.testSuiteTests).where(eq(schema.testSuiteTests.id, linkId))
      }
    }
  }

  return { success: true }
}

export default function Suites() {
  const { suites, availableTests } = useLoaderData<typeof loader>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  return (
    <div className="flex min-h-screen bg-gray-900 font-sans text-gray-100">
      {/* Sidebar */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-950 p-6">
        <a
          href="/"
          className="mb-8 flex items-center gap-3 text-lg font-semibold text-white no-underline transition-colors hover:text-blue-400"
        >
          <img src="/logo.svg" alt="qaos" className="h-8 w-8 brightness-200 filter" />
          <span>qaos</span>
        </a>
        <nav className="flex flex-col gap-2">
          <a
            href="/"
            className="rounded-md px-3 py-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            Chat Tests
          </a>
          <a
            href="/suites"
            className="rounded-md border border-blue-900/50 bg-blue-900/30 px-3 py-2 font-medium text-blue-400"
          >
            Test Suites
          </a>
          <a
            href="/settings"
            className="rounded-md px-3 py-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            Settings
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 p-8">
        <header className="mb-8 flex items-end justify-between border-b border-gray-800 pb-4">
          <div>
            <h1 className="mb-2 text-3xl font-bold">Test Suites</h1>
            <p className="text-sm text-gray-400">
              Group your individual chat tests into repeatable suites.
            </p>
          </div>
        </header>

        {/* Create Suite Form */}
        <section className="mb-8 rounded-lg border border-gray-700/50 bg-gray-800/50 p-6 shadow-xl">
          <h2 className="mb-4 text-xl font-semibold text-white">Create New Suite</h2>
          <Form method="post" className="flex max-w-md flex-col gap-4">
            <input type="hidden" name="intent" value="create_suite" />
            <div>
              <label className="mb-1 block text-sm text-gray-400">Suite Name</label>
              <input
                type="text"
                name="name"
                required
                placeholder="e.g. Core Regression"
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white transition-colors focus:border-blue-500 focus:outline-none"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Description (Optional)</label>
              <textarea
                name="description"
                rows={2}
                placeholder="What does this suite cover?"
                className="w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white transition-colors focus:border-blue-500 focus:outline-none"
                disabled={isSubmitting}
              />
            </div>
            <button
              type="submit"
              className="self-start rounded-md bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Suite'}
            </button>
          </Form>
        </section>

        {/* Suites List */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {suites.length === 0 ? (
            <div className="col-span-full rounded-lg border border-dashed border-gray-700 py-12 text-center text-gray-500">
              No suites found. Create one above to get started.
            </div>
          ) : (
            suites.map(suite => (
              <div
                key={suite.id}
                className="group flex flex-col rounded-lg border border-gray-700 bg-gray-800 shadow-md"
              >
                <div className="flex items-start justify-between border-b border-gray-700 p-5">
                  <div>
                    <h3 className="mb-1 text-lg font-bold text-white transition-colors group-hover:text-blue-400">
                      {suite.name}
                    </h3>
                    {suite.description && (
                      <p className="mb-2 text-sm text-gray-400">{suite.description}</p>
                    )}
                    <span className="font-mono text-xs text-gray-500">ID: {suite.id}</span>
                  </div>
                  <Form
                    method="post"
                    onSubmit={e => !confirm('Delete this suite?') && e.preventDefault()}
                  >
                    <input type="hidden" name="intent" value="delete_suite" />
                    <input type="hidden" name="suiteId" value={suite.id} />
                    <button
                      type="submit"
                      className="p-1 text-gray-500 transition-colors hover:text-red-400"
                      title="Delete Suite"
                    >
                      🗑️
                    </button>
                  </Form>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  {/* List of Tests in Suite */}
                  <div className="mb-4 flex-1">
                    <h4 className="mb-3 text-sm font-medium tracking-wider text-gray-300 uppercase">
                      Tests in Suite ({suite.tests.length})
                    </h4>
                    {suite.tests.length === 0 ? (
                      <p className="rounded bg-gray-900/50 p-3 text-sm text-gray-500 italic">
                        No tests added yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {suite.tests.map((test: any) => (
                          <li
                            key={test.linkId}
                            className="flex items-center justify-between rounded border border-gray-700/50 bg-gray-900 px-3 py-2"
                          >
                            <span
                              className="truncate pr-2 text-sm text-gray-200"
                              title={test.title || 'Untitled Test'}
                            >
                              {test.title || 'Untitled Test'}
                            </span>
                            <Form method="post">
                              <input type="hidden" name="intent" value="remove_test" />
                              <input type="hidden" name="linkId" value={test.linkId} />
                              <button
                                type="submit"
                                className="px-1 text-xs text-gray-500 hover:text-red-400"
                                title="Remove Test from Suite"
                              >
                                ✖
                              </button>
                            </Form>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Add Test to Suite Form */}
                  <Form method="post" className="mt-auto flex gap-2 border-t border-gray-700 pt-3">
                    <input type="hidden" name="intent" value="add_test" />
                    <input type="hidden" name="suiteId" value={suite.id} />
                    <select
                      name="testId"
                      required
                      className="flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">Select test to add...</option>
                      {availableTests
                        // Don't show tests already in the suite
                        .filter(t => !suite.tests.some((st: any) => st.id === t.id))
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.title || 'Untitled Test'}
                          </option>
                        ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded bg-gray-700 px-3 py-1.5 text-sm text-white transition-colors hover:bg-gray-600"
                    >
                      Add
                    </button>
                  </Form>
                </div>
              </div>
            ))
          )}
        </section>
      </main>
    </div>
  )
}
