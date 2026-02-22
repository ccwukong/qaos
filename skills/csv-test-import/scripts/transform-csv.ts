import fs from 'node:fs'
import path from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'
import { Pool } from 'pg'

type Mapping = Record<string, string>

interface ScriptArgs {
  csvPath: string
  testId: string
  mapping: Mapping
  batchSize?: number
  delimiter?: string
  encoding?: BufferEncoding
  sourceFile?: string
}

interface InsertRow {
  testId: string
  sourceFile: string
  recordIndex: number
  title: string | null
  priority: string | null
  description: string | null
  normalizedRecord: Record<string, unknown>
  rawRecord: Record<string, unknown>
}

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function isEffectivelyEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every(value => {
    if (value === undefined || value === null) return true
    return String(value).trim() === ''
  })
}

function pickFirstField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeText(record[key])
    if (value) return value
  }
  return null
}

function mapRow(raw: Record<string, unknown>, mapping: Mapping): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [rawColumn, normalizedField] of Object.entries(mapping)) {
    normalized[normalizedField] = normalizeText(raw[rawColumn])
  }
  return normalized
}

async function insertBatch(pool: Pool, rows: InsertRow[]): Promise<number> {
  if (rows.length === 0) return 0

  const values: unknown[] = []
  const placeholders: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const offset = i * 8
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb, $${offset + 8}::jsonb)`
    )
    const row = rows[i]
    values.push(
      row.testId,
      row.sourceFile,
      row.recordIndex,
      row.title,
      row.priority,
      row.description,
      JSON.stringify(row.normalizedRecord),
      JSON.stringify(row.rawRecord)
    )
  }

  await pool.query(
    `
      INSERT INTO test_records (
        test_id,
        source_file,
        record_index,
        title,
        priority,
        description,
        normalized_record,
        raw_record
      ) VALUES ${placeholders.join(',')}
    `,
    values
  )

  return rows.length
}

export default async function transformCsv(args: ScriptArgs) {
  if (!args?.csvPath) {
    throw new Error('Missing required argument: csvPath')
  }
  if (!args?.testId) {
    throw new Error('Missing required argument: testId')
  }
  if (!args?.mapping || Object.keys(args.mapping).length === 0) {
    throw new Error('Missing required argument: mapping')
  }

  const csvPath = path.isAbsolute(args.csvPath)
    ? args.csvPath
    : path.resolve(process.cwd(), args.csvPath)

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`)
  }

  const connectionString = process.env.DATABASE_URL
  if (
    !connectionString ||
    (!connectionString.startsWith('postgresql://') && !connectionString.startsWith('postgres://'))
  ) {
    throw new Error('DATABASE_URL must point to PostgreSQL')
  }

  const batchSize = Number.isFinite(args.batchSize) ? Math.max(50, Number(args.batchSize)) : 500
  const delimiter = args.delimiter ?? ','
  const encoding = args.encoding ?? 'utf8'
  const sourceFile = args.sourceFile ?? path.basename(csvPath)

  const pool = new Pool({ connectionString })

  let insertedCount = 0
  let skippedCount = 0
  let readCount = 0
  let recordIndex = 0
  const batch: InsertRow[] = []

  const flush = async () => {
    if (batch.length === 0) return
    insertedCount += await insertBatch(pool, batch)
    batch.length = 0
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_records (
        id BIGSERIAL PRIMARY KEY,
        test_id TEXT NOT NULL,
        source_file TEXT NOT NULL,
        record_index INTEGER NOT NULL,
        title TEXT,
        priority TEXT,
        description TEXT,
        normalized_record JSONB NOT NULL,
        raw_record JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const parser = parse({
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      delimiter,
    })

    const transformer = new Transform({
      objectMode: true,
      transform(chunk: Record<string, unknown>, _, callback) {
        readCount += 1

        if (!chunk || isEffectivelyEmpty(chunk)) {
          skippedCount += 1
          callback()
          return
        }

        const normalized = mapRow(chunk, args.mapping)
        const title =
          pickFirstField(normalized, ['title', 'testName', 'name']) ??
          pickFirstField(chunk, ['Test case', 'Test', 'Name', 'Title'])
        const priority =
          pickFirstField(normalized, ['priority']) ?? pickFirstField(chunk, ['Priority'])
        const description =
          pickFirstField(normalized, ['description', 'details']) ??
          pickFirstField(chunk, ['Description', 'Steps', 'Expected'])

        if (!title && !description) {
          skippedCount += 1
          callback()
          return
        }

        recordIndex += 1
        callback(null, {
          testId: args.testId,
          sourceFile,
          recordIndex,
          title,
          priority,
          description,
          normalizedRecord: normalized,
          rawRecord: chunk,
        } satisfies InsertRow)
      },
    })

    const sink = new Writable({
      objectMode: true,
      async write(row: InsertRow, _, callback) {
        try {
          batch.push(row)
          if (batch.length >= batchSize) {
            await flush()
          }
          callback()
        } catch (error) {
          callback(error as Error)
        }
      },
      async final(callback) {
        try {
          await flush()
          callback()
        } catch (error) {
          callback(error as Error)
        }
      },
    })

    await pipeline(fs.createReadStream(csvPath, { encoding }), parser, transformer, sink)

    return {
      ok: true,
      csvPath,
      sourceFile,
      testId: args.testId,
      mapping: args.mapping,
      readCount,
      insertedCount,
      skippedCount,
      batchSize,
    }
  } finally {
    await pool.end()
  }
}
