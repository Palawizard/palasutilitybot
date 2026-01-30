import { EmbedBuilder } from 'discord.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ensureSchema, hasDb, query } from '../db.js'

const dataDir = path.join(process.cwd(), 'data')
const filePath = path.join(dataDir, 'reminders.json')

let store = { seq: 0, items: [] }
let loaded = false
let started = false

function logError(ctx, err) {
    const msg = err && err.stack ? err.stack : String(err)
    console.error(`[REM:ERROR] ${ctx}: ${msg}`)
}

function ensurePaths() {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    if (!existsSync(filePath)) writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8')
}

function migrate(raw) {
    try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
            const nums = parsed.map(r => Number(r.id)).filter(n => Number.isFinite(n))
            const seq = nums.length ? Math.max(...nums) : 0
            return { seq, items: parsed.map((r, i) => ({ ...r, id: Number(r.id) || i + 1 })) }
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
            const nums = parsed.items.map(r => Number(r.id)).filter(n => Number.isFinite(n))
            const seq = Number.isFinite(parsed.seq) ? Math.max(parsed.seq, nums.length ? Math.max(...nums) : 0) : (nums.length ? Math.max(...nums) : 0)
            return { seq, items: parsed.items.map(r => ({ ...r, id: Number(r.id) || ++store.seq })) }
        }
    } catch (e) {
        logError('migrate parse', e)
    }
    return { seq: 0, items: [] }
}

function load() {
    if (loaded) return
    try {
        ensurePaths()
        const raw = readFileSync(filePath, 'utf8')
        store = migrate(raw)
        console.log(`[REM:load] seq=${store.seq} items=${store.items.length}`)
    } catch (e) {
        logError('load', e)
        store = { seq: 0, items: [] }
    }
    loaded = true
}

function save() {
    try {
        writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8')
        console.log(`[REM:save] seq=${store.seq} items=${store.items.length}`)
    } catch (e) {
        logError('save', e)
    }
}

function nextTimestamp(ts, recur) {
    const d = new Date(ts)
    if (recur === 'daily') d.setDate(d.getDate() + 1)
    else if (recur === 'weekly') d.setDate(d.getDate() + 7)
    else if (recur === 'monthly') d.setMonth(d.getMonth() + 1)
    else return null
    return d.getTime()
}

function normalizeRow(r) {
    return {
        id: Number(r.id),
        userId: r.user_id,
        channelId: r.channel_id,
        guildId: r.guild_id,
        text: r.text,
        timestamp: Number(r.timestamp),
        recur: r.recur,
        paused: r.paused,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at)
    }
}

async function addReminderDb(rem) {
    await ensureSchema()
    const res = await query(
        `INSERT INTO reminders (user_id, channel_id, guild_id, text, timestamp, recur, paused, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [rem.userId, rem.channelId, rem.guildId, rem.text, rem.timestamp, rem.recur, rem.paused, rem.createdAt, rem.updatedAt]
    )
    const id = Number(res.rows[0]?.id)
    console.log(`[REM:add] id=${id} user=${rem.userId} ts=${rem.timestamp} recur=${rem.recur}`)
    return id
}

async function getUserRemindersPagedDb(userId, page, perPage) {
    await ensureSchema()
    const totalRes = await query('SELECT COUNT(*)::int AS total FROM reminders WHERE user_id = $1', [userId])
    const total = totalRes.rows[0]?.total ?? 0
    const start = (page - 1) * perPage
    const itemsRes = await query(
        'SELECT * FROM reminders WHERE user_id = $1 ORDER BY timestamp ASC, id ASC LIMIT $2 OFFSET $3',
        [userId, perPage, start]
    )
    const items = itemsRes.rows.map(normalizeRow)
    console.log(`[REM:list] user=${userId} page=${page} total=${total}`)
    return { total, items }
}

async function deleteReminderDb(id, userId) {
    await ensureSchema()
    const target = Number(id)
    const res = await query('DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id', [target, userId])
    const changed = res.rowCount > 0
    console.log(`[REM:delete] id=${id} user=${userId} ok=${changed}`)
    return changed
}

async function pauseReminderDb(id, userId) {
    await ensureSchema()
    const target = Number(id)
    const now = Date.now()
    const res = await query(
        'UPDATE reminders SET paused = true, updated_at = $3 WHERE id = $1 AND user_id = $2',
        [target, userId, now]
    )
    const ok = res.rowCount > 0
    if (ok) console.log(`[REM:pause] id=${id} user=${userId}`)
    return ok
}

async function resumeReminderDb(id, userId) {
    await ensureSchema()
    const target = Number(id)
    const now = Date.now()
    const res = await query(
        'UPDATE reminders SET paused = false, updated_at = $3 WHERE id = $1 AND user_id = $2',
        [target, userId, now]
    )
    const ok = res.rowCount > 0
    if (ok) console.log(`[REM:resume] id=${id} user=${userId}`)
    return ok
}

async function updateReminderDb(id, userId, { text, dateStr, timeStr, repeat }) {
    await ensureSchema()
    const target = Number(id)
    const res = await query('SELECT * FROM reminders WHERE id = $1 AND user_id = $2', [target, userId])
    if (!res.rowCount) return false
    const r = normalizeRow(res.rows[0])

    let nextText = r.text
    let nextRecur = r.recur
    let nextTimestamp = r.timestamp

    if (text !== undefined) nextText = text
    if (repeat !== undefined) nextRecur = repeat
    if (dateStr !== undefined || timeStr !== undefined) {
        const d = new Date(r.timestamp)
        let y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate()
        let hh = d.getHours(), mm = d.getMinutes()
        if (dateStr) {
            const [yy, mo, dd] = dateStr.split('-').map(Number)
            y = yy; m = mo; day = dd
        }
        if (timeStr) {
            const [h, mi] = timeStr.split(':').map(Number)
            hh = h; mm = mi
        }
        const nd = new Date()
        nd.setFullYear(y, (m ?? 1) - 1, day ?? 1)
        nd.setHours(hh ?? 0, mm ?? 0, 0, 0)
        const ts = nd.getTime()
        if (Number.isNaN(ts)) return false
        nextTimestamp = ts
    }

    const now = Date.now()
    await query(
        'UPDATE reminders SET text = $1, recur = $2, timestamp = $3, updated_at = $4 WHERE id = $5 AND user_id = $6',
        [nextText, nextRecur, nextTimestamp, now, target, userId]
    )
    console.log(`[REM:update] id=${id} user=${userId} repeat=${nextRecur} ts=${nextTimestamp}`)
    return true
}

export async function addReminder(rem) {
    if (hasDb()) return addReminderDb(rem)
    load()
    const rec = { ...rem }
    rec.id = ++store.seq
    store.items.push(rec)
    console.log(`[REM:add] id=${rec.id} user=${rec.userId} ts=${rec.timestamp} recur=${rec.recur}`)
    save()
    return rec.id
}

export async function getUserRemindersPaged(userId, page = 1, perPage = 5) {
    if (hasDb()) return getUserRemindersPagedDb(userId, page, perPage)
    load()
    const all = store.items.filter(r => r.userId === userId).sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
    const total = all.length
    const start = (page - 1) * perPage
    const items = all.slice(start, start + perPage)
    console.log(`[REM:list] user=${userId} page=${page} total=${total}`)
    return { total, items }
}

export async function deleteReminder(id, userId) {
    if (hasDb()) return deleteReminderDb(id, userId)
    load()
    const target = Number(id)
    const before = store.items.length
    store.items = store.items.filter(r => !(r.id === target && r.userId === userId))
    const changed = store.items.length !== before
    console.log(`[REM:delete] id=${id} user=${userId} ok=${changed}`)
    if (changed) save()
    return changed
}

export async function pauseReminder(id, userId) {
    if (hasDb()) return pauseReminderDb(id, userId)
    load()
    const target = Number(id)
    const r = store.items.find(x => x.id === target && x.userId === userId)
    if (!r) return false
    r.paused = true
    r.updatedAt = Date.now()
    console.log(`[REM:pause] id=${id} user=${userId}`)
    save()
    return true
}

export async function resumeReminder(id, userId) {
    if (hasDb()) return resumeReminderDb(id, userId)
    load()
    const target = Number(id)
    const r = store.items.find(x => x.id === target && x.userId === userId)
    if (!r) return false
    r.paused = false
    r.updatedAt = Date.now()
    console.log(`[REM:resume] id=${id} user=${userId}`)
    save()
    return true
}

export async function updateReminder(id, userId, { text, dateStr, timeStr, repeat }) {
    if (hasDb()) return updateReminderDb(id, userId, { text, dateStr, timeStr, repeat })
    load()
    const target = Number(id)
    const r = store.items.find(x => x.id === target && x.userId === userId)
    if (!r) return false
    if (text !== undefined) r.text = text
    if (repeat !== undefined) r.recur = repeat
    if (dateStr !== undefined || timeStr !== undefined) {
        const d = new Date(r.timestamp)
        let y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate()
        let hh = d.getHours(), mm = d.getMinutes()
        if (dateStr) {
            const [yy, mo, dd] = dateStr.split('-').map(Number)
            y = yy; m = mo; day = dd
        }
        if (timeStr) {
            const [h, mi] = timeStr.split(':').map(Number)
            hh = h; mm = mi
        }
        const nd = new Date()
        nd.setFullYear(y, (m ?? 1) - 1, day ?? 1)
        nd.setHours(hh ?? 0, mm ?? 0, 0, 0)
        const ts = nd.getTime()
        if (Number.isNaN(ts)) return false
        r.timestamp = ts
    }
    r.updatedAt = Date.now()
    console.log(`[REM:update] id=${id} user=${userId} repeat=${r.recur} ts=${r.timestamp}`)
    save()
    return true
}

async function initRemindersDb(client) {
    await ensureSchema()
    setInterval(async () => {
        try {
            const now = Date.now()
            const res = await query(
                'SELECT * FROM reminders WHERE timestamp <= $1 AND paused = false ORDER BY timestamp ASC',
                [now]
            )
            const due = res.rows.map(normalizeRow)
            if (!due.length) return
            console.log(`[REM:tick] due=${due.length} now=${now}`)
            for (const r of due) {
                try {
                    const unix = Math.floor(r.timestamp / 1000)
                    const embed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setAuthor({ name: 'Reminder' })
                        .setDescription(r.text)
                        .addFields(
                            { name: 'When', value: `<t:${unix}:F> • <t:${unix}:R>` },
                            { name: 'Info', value: `ID ${r.id} • ${r.recur} • ${r.paused ? 'paused' : 'active'}` }
                        )

                    try {
                        const user = await client.users.fetch(r.userId)
                        await user.send({ embeds: [embed] })
                        console.log(`[REM:send:dm] id=${r.id} user=${r.userId}`)
                    } catch (e) {
                        logError(`send DM to ${r.userId}`, e)
                    }

                    if (r.recur === 'none') {
                        await query('DELETE FROM reminders WHERE id = $1', [r.id])
                        console.log(`[REM:cleanup] removed one-shot id=${r.id}`)
                    } else {
                        const next = nextTimestamp(r.timestamp, r.recur)
                        if (next) {
                            await query('UPDATE reminders SET timestamp = $1, updated_at = $2 WHERE id = $3', [next, Date.now(), r.id])
                            console.log(`[REM:reschedule] id=${r.id} next=${next} recur=${r.recur}`)
                        } else {
                            await query('DELETE FROM reminders WHERE id = $1', [r.id])
                            console.log(`[REM:cleanup] removed invalid recur id=${r.id}`)
                        }
                    }
                } catch (e) {
                    logError(`process reminder ${r.id}`, e)
                }
            }
        } catch (loopErr) {
            logError('scheduler loop', loopErr)
        }
    }, 15000)
}

export function initReminders(client) {
    if (started) return
    started = true
    if (hasDb()) {
        initRemindersDb(client).catch(e => logError('initRemindersDb', e))
        return
    }
    load()
    setInterval(async () => {
        try {
            const now = Date.now()
            const due = store.items.filter(r => r.timestamp <= now && !r.paused)
            if (!due.length) return
            console.log(`[REM:tick] due=${due.length} now=${now}`)
            for (const r of due) {
                try {
                    const unix = Math.floor(r.timestamp / 1000)
                    const embed = new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setAuthor({ name: 'Reminder' })
                        .setDescription(r.text)
                        .addFields(
                            { name: 'When', value: `<t:${unix}:F> • <t:${unix}:R>` },
                            { name: 'Info', value: `ID ${r.id} • ${r.recur} • ${r.paused ? 'paused' : 'active'}` }
                        )

                    try {
                        const user = await client.users.fetch(r.userId)
                        await user.send({ embeds: [embed] })
                        console.log(`[REM:send:dm] id=${r.id} user=${r.userId}`)
                    } catch (e) {
                        logError(`send DM to ${r.userId}`, e)
                    }

                    if (r.recur === 'none') {
                        store.items = store.items.filter(x => x.id !== r.id)
                        console.log(`[REM:cleanup] removed one-shot id=${r.id}`)
                    } else {
                        const next = nextTimestamp(r.timestamp, r.recur)
                        if (next) {
                            r.timestamp = next
                            r.updatedAt = Date.now()
                            console.log(`[REM:reschedule] id=${r.id} next=${r.timestamp} recur=${r.recur}`)
                        } else {
                            store.items = store.items.filter(x => x.id !== r.id)
                            console.log(`[REM:cleanup] removed invalid recur id=${r.id}`)
                        }
                    }
                } catch (e) {
                    logError(`process reminder ${r.id}`, e)
                }
            }
            save()
        } catch (loopErr) {
            logError('scheduler loop', loopErr)
        }
    }, 15000)
}
