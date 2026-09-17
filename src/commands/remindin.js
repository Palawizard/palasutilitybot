import { SlashCommandBuilder, EmbedBuilder } from 'discord.js'
import { addReminder } from '../scheduler/reminders.js'

const units = {
    j: 86400000, jour: 86400000, jours: 86400000, d: 86400000, day: 86400000, days: 86400000,
    h: 3600000, heure: 3600000, heures: 3600000, hour: 3600000, hours: 3600000,
    m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
    s: 1000, sec: 1000, secs: 1000, seconde: 1000, secondes: 1000, second: 1000, seconds: 1000
}

// "2h et 15min", "dans 30 minutes", "1j 2h 30m" -> ms (null si rien de valide)
export function parseDuration(input) {
    const re = /(\d+)\s*([a-zA-Zéè]+)/g
    let total = 0
    let matched = false
    for (const [, amount, unit] of input.toLowerCase().matchAll(re)) {
        const ms = units[unit]
        if (ms === undefined) return null
        total += Number(amount) * ms
        matched = true
    }
    return matched && total > 0 ? total : null
}

function formatDuration(ms) {
    const parts = []
    const d = Math.floor(ms / 86400000)
    const h = Math.floor(ms / 3600000) % 24
    const m = Math.floor(ms / 60000) % 60
    const s = Math.floor(ms / 1000) % 60
    if (d) parts.push(`${d}j`)
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}min`)
    if (s) parts.push(`${s}s`)
    return parts.join(' ')
}

export default {
    data: new SlashCommandBuilder()
        .setName('remindin')
        .setDescription('Créer un rappel dans X temps (ex: 30min, 2h et 15min, 1j 2h)')
        .setDMPermission(true)
        .addStringOption(o => o.setName('duree').setDescription('ex: 30min, 2h et 15min, 1j 2h 30m').setRequired(true))
        .addStringOption(o => o.setName('text').setDescription('Texte du rappel').setRequired(true).setMaxLength(2000)),
    async execute(interaction) {
        const ephemeral = interaction.inGuild() ? { flags: 64 } : {}
        try {
            const raw = interaction.options.getString('duree', true)
            const text = interaction.options.getString('text', true)
            const ms = parseDuration(raw)
            if (ms === null) {
                return interaction.reply({ content: 'Durée invalide. Exemples : `30min`, `2h et 15min`, `1j 2h 30m`.', ...ephemeral })
            }

            const ts = Date.now() + ms
            const id = await addReminder({
                userId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId ?? null,
                text,
                timestamp: ts,
                recur: 'none',
                paused: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
            })

            const unix = Math.floor(ts / 1000)
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({ name: 'Reminder scheduled' })
                .setDescription(text)
                .addFields(
                    { name: 'ID', value: `${id}`, inline: true },
                    { name: 'When', value: `<t:${unix}:F> • <t:${unix}:R>`, inline: true },
                    { name: 'In', value: formatDuration(ms), inline: true }
                )
            return interaction.reply({ embeds: [embed], ...ephemeral })
        } catch (e) {
            console.error('[REMINDIN] error:', e)
            const payload = { content: 'There was an error executing this command.', ...ephemeral }
            if (interaction.deferred || interaction.replied) {
                try { await interaction.editReply(payload.content) } catch {}
            } else {
                try { await interaction.reply(payload) } catch {}
            }
        }
    }
}
