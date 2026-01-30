import pg from 'pg'

const { Pool } = pg

const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.SCALINGO_POSTGRESQL_URL ||
    process.env.POSTGRESQL_URL

const shouldUseDb = Boolean(databaseUrl)
const shouldUseSsl = process.env.PGSSLMODE === 'require' || process.env.DATABASE_SSL === 'true' || process.env.SCALINGO_POSTGRESQL_URL

let pool
let schemaReady = false

function logError(ctx, err) {
    const msg = err && err.stack ? err.stack : String(err)
    console.error(`[DB:ERROR] ${ctx}: ${msg}`)
}

export function hasDb() {
    return shouldUseDb
}

function getPool() {
    if (!shouldUseDb) return null
    if (!pool) {
        pool = new Pool({
            connectionString: databaseUrl,
            ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined
        })
        pool.on('error', err => logError('pool', err))
    }
    return pool
}

export async function query(text, params) {
    const p = getPool()
    if (!p) throw new Error('Database not configured')
    return p.query(text, params)
}

export async function ensureSchema() {
    if (!shouldUseDb || schemaReady) return
    const p = getPool()
    if (!p) return
    await p.query(`
        CREATE TABLE IF NOT EXISTS reminders (
            id BIGSERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            channel_id TEXT,
            guild_id TEXT,
            text TEXT NOT NULL,
            timestamp BIGINT NOT NULL,
            recur TEXT NOT NULL,
            paused BOOLEAN NOT NULL DEFAULT false,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL
        );
    `)
    await p.query(`CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);`)
    await p.query(`CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(timestamp, paused);`)
    await p.query(`
        CREATE TABLE IF NOT EXISTS raaah_gifs (
            id BIGSERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            created_at BIGINT NOT NULL
        );
    `)
    schemaReady = true
    console.log('[DB] schema ready')
}
