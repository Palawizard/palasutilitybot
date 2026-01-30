import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ensureSchema, hasDb, query } from './db.js'

const dataDir = path.join(process.cwd(), 'data')
const filePath = path.join(dataDir, 'raaah.json')

let store = { items: [] }
let loaded = false

function logError(ctx, err) {
    const msg = err && err.stack ? err.stack : String(err)
    console.error(`[RAAAH:ERROR] ${ctx}: ${msg}`)
}

function ensurePaths() {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    if (!existsSync(filePath)) writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8')
}

function normalizeStore(raw) {
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            return { items: parsed.filter(item => typeof item === 'string' && item.trim().length).map(item => item.trim()) }
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
            return { items: parsed.items.filter(item => typeof item === 'string' && item.trim().length).map(item => item.trim()) }
        }
    } catch (e) {
        logError('normalizeStore', e)
    }
    return { items: [] }
}

function load() {
    if (loaded) return
    try {
        ensurePaths()
        const raw = readFileSync(filePath, 'utf8')
        store = normalizeStore(raw)
        console.log(`[RAAAH:load] items=${store.items.length}`)
    } catch (e) {
        logError('load', e)
        store = { items: [] }
    }
    loaded = true
}

function save() {
    try {
        writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8')
        console.log(`[RAAAH:save] items=${store.items.length}`)
    } catch (e) {
        logError('save', e)
    }
}

async function getRandomGifDb() {
    await ensureSchema()
    const res = await query('SELECT url FROM raaah_gifs ORDER BY RANDOM() LIMIT 1')
    return res.rows[0]?.url ?? null
}

export async function getRandomGif() {
    if (hasDb()) {
        return getRandomGifDb()
    }
    load()
    if (!store.items.length) return null
    const idx = Math.floor(Math.random() * store.items.length)
    return store.items[idx]
}

async function addGifDb(url) {
    await ensureSchema()
    const clean = url.trim()
    const now = Date.now()
    const res = await query(
        'INSERT INTO raaah_gifs (url, created_at) VALUES ($1, $2) ON CONFLICT (url) DO NOTHING RETURNING id',
        [clean, now]
    )
    const totalRes = await query('SELECT COUNT(*)::int AS total FROM raaah_gifs')
    const total = totalRes.rows[0]?.total ?? 0
    if (!res.rowCount) {
        return { added: false, reason: 'duplicate', total }
    }
    return { added: true, total }
}

export async function addGif(url) {
    if (hasDb()) {
        return addGifDb(url)
    }
    load()
    const clean = url.trim()
    if (store.items.includes(clean)) {
        return { added: false, reason: 'duplicate', total: store.items.length }
    }
    store.items.push(clean)
    save()
    return { added: true, total: store.items.length }
}
