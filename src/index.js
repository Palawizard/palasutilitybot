import { Client, GatewayIntentBits, Collection, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Partials } from 'discord.js'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { initReminders, getUserRemindersPaged } from './scheduler/reminders.js'

const EPHEMERAL = 64
const perPage = 5

function logError(ctx, err) {
    const msg = err && err.stack ? err.stack : String(err)
    console.error(`[ERROR] ${ctx}: ${msg}`)
}

process.on('unhandledRejection', err => logError('unhandledRejection', err))
process.on('uncaughtException', err => logError('uncaughtException', err))

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] })

client.commands = new Collection()

const commandsPath = path.join(process.cwd(), 'src', 'commands')
try {
    const files = readdirSync(commandsPath).filter(f => f.endsWith('.js'))
    console.log(`[BOOT] Loading commands from ${commandsPath}: ${files.join(', ')}`)
    for (const file of files) {
        try {
            const fileUrl = pathToFileURL(path.join(commandsPath, file)).href
            const mod = await import(fileUrl)
            const command = mod.default ?? mod
            if (command.data && command.execute) {
                client.commands.set(command.data.name, command)
                console.log(`[BOOT] Registered command: ${command.data.name}`)
            } else {
                console.warn(`[BOOT] Skipped file (no data/execute): ${file}`)
            }
        } catch (e) {
            logError(`loading command ${file}`, e)
        }
    }
    console.log(`[BOOT] Total commands: ${client.commands.size}`)
} catch (e) {
    logError('reading commands directory', e)
}

client.once(Events.ClientReady, c => {
    console.log(`[READY] Logged in as ${c.user.tag}`)
    try {
        initReminders(client)
        console.log('[READY] Reminders scheduler started')
    } catch (e) {
        logError('initReminders', e)
    }
})

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isButton()) {
            const id = interaction.customId
            if (!['rem:list:prev', 'rem:list:next'].includes(id)) return
            const ownerId = interaction.message.interaction?.user?.id ?? interaction.user.id
            if (ownerId && ownerId !== interaction.user.id) {
                const flags = interaction.inGuild() ? { flags: EPHEMERAL } : {}
                return interaction.reply({ content: 'Not your pager.', ...flags })
            }
            const footer = interaction.message.embeds[0]?.footer?.text ?? 'Page 1/1'
            const m = footer.match(/Page\s+(\d+)\/(\d+)/i)
            const current = m ? parseInt(m[1], 10) : 1
            const totalPages = m ? parseInt(m[2], 10) : 1
            const nextPage = id === 'rem:list:next' ? Math.min(totalPages, current + 1) : Math.max(1, current - 1)
            const user = interaction.user
            const { total, items } = getUserRemindersPaged(user.id, nextPage, perPage)
            const tp = Math.max(1, Math.ceil(total / perPage))
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({ name: `${user.username}'s reminders`, iconURL: user.displayAvatarURL?.() })
                .setFooter({ text: `Page ${nextPage}/${tp} • Total ${total}` })

            if (!items.length) {
                embed.setDescription('No reminders found')
            } else {
                for (const r of items) {
                    const unix = Math.floor(r.timestamp / 1000)
                    embed.addFields({
                        name: `ID ${r.id} • ${r.recur} • ${r.paused ? 'paused' : 'active'}`,
                        value: `${r.text}\n<t:${unix}:F> • <t:${unix}:R>`
                    })
                }
            }

            const prev = new ButtonBuilder().setCustomId('rem:list:prev').setStyle(ButtonStyle.Secondary).setLabel('Prev').setDisabled(nextPage <= 1)
            const next = new ButtonBuilder().setCustomId('rem:list:next').setStyle(ButtonStyle.Secondary).setLabel('Next').setDisabled(nextPage >= tp)
            const row = new ActionRowBuilder().addComponents(prev, next)
            return interaction.update({ embeds: [embed], components: [row] })
        }

        if (!interaction.isChatInputCommand()) return
        console.log(`[CMD] /${interaction.commandName} by ${interaction.user.id} in ${interaction.guildId ?? 'DM'}:${interaction.channelId}`)
        const command = client.commands.get(interaction.commandName)
        if (!command) {
            const flags = interaction.inGuild() ? { flags: EPHEMERAL } : {}
            console.warn(`[CMD] Missing handler for ${interaction.commandName}`)
            return interaction.reply({ content: 'Unknown command.', ...flags })
        }
        try {
            await command.execute(interaction)
        } catch (e) {
            logError(`execute ${interaction.commandName}`, e)
            if (interaction.deferred || interaction.replied) {
                try { await interaction.editReply('There was an error executing this command.') } catch (e2) { logError('editReply fallback', e2) }
            } else {
                const flags = interaction.inGuild() ? { flags: EPHEMERAL } : {}
                try { await interaction.reply({ content: 'There was an error executing this command.', ...flags }) } catch (e3) { logError('reply fallback', e3) }
            }
        }
    } catch (outer) {
        logError('InteractionCreate handler', outer)
    }
})

client.login(process.env.TOKEN).catch(e => logError('client.login', e))
