import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import { addReminder, getUserRemindersPaged, deleteReminder, updateReminder, pauseReminder, resumeReminder } from '../scheduler/reminders.js'

const perPage = 5

async function renderListEmbed(user, page) {
    const { total, items } = await getUserRemindersPaged(user.id, page, perPage)
    const totalPages = Math.max(1, Math.ceil(total / perPage))
    const embed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setAuthor({ name: `${user.username}'s reminders`, iconURL: user.displayAvatarURL?.() })
        .setFooter({ text: `Page ${page}/${totalPages} • Total ${total}` })

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

    const prev = new ButtonBuilder().setCustomId('rem:list:prev').setStyle(ButtonStyle.Secondary).setLabel('Prev').setDisabled(page <= 1)
    const next = new ButtonBuilder().setCustomId('rem:list:next').setStyle(ButtonStyle.Secondary).setLabel('Next').setDisabled(page >= totalPages)
    const row = new ActionRowBuilder().addComponents(prev, next)
    return { embed, components: [row] }
}

function guildEphemeral(interaction) {
    return interaction.inGuild() ? { flags: 64 } : {}
}

export default {
    data: new SlashCommandBuilder()
        .setName('reminder')
        .setDescription('Reminder utilities')
        .setDMPermission(true)
        .addSubcommand(sc => sc
            .setName('add')
            .setDescription('Create a reminder')
            .addStringOption(o => o.setName('text').setDescription('Reminder text').setRequired(true).setMaxLength(2000))
            .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD').setRequired(true))
            .addStringOption(o => o.setName('time').setDescription('HH:mm (24h)').setRequired(true))
            .addStringOption(o => o.setName('repeat').setDescription('Recurrence').addChoices(
                { name: 'none', value: 'none' },
                { name: 'daily', value: 'daily' },
                { name: 'weekly', value: 'weekly' },
                { name: 'monthly', value: 'monthly' }
            ).setRequired(true)))
        .addSubcommand(sc => sc
            .setName('list')
            .setDescription('List my reminders')
            .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)))
        .addSubcommand(sc => sc
            .setName('delete')
            .setDescription('Delete a reminder')
            .addStringOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true)))
        .addSubcommand(sc => sc
            .setName('edit')
            .setDescription('Edit a reminder')
            .addStringOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true))
            .addStringOption(o => o.setName('text').setDescription('New text'))
            .addStringOption(o => o.setName('date').setDescription('YYYY-MM-DD'))
            .addStringOption(o => o.setName('time').setDescription('HH:mm (24h)'))
            .addStringOption(o => o.setName('repeat').setDescription('Recurrence').addChoices(
                { name: 'none', value: 'none' },
                { name: 'daily', value: 'daily' },
                { name: 'weekly', value: 'weekly' },
                { name: 'monthly', value: 'monthly' }
            )))
        .addSubcommand(sc => sc
            .setName('pause')
            .setDescription('Pause a reminder')
            .addStringOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true)))
        .addSubcommand(sc => sc
            .setName('resume')
            .setDescription('Resume a reminder')
            .addStringOption(o => o.setName('id').setDescription('Reminder ID').setRequired(true))),
    async execute(interaction) {
        const sub = interaction.options.getSubcommand()
        console.log(`[REMINDER] sub=${sub} where=${interaction.inGuild() ? 'guild' : 'dm'} user=${interaction.user.id}`)
        try {
            if (sub === 'add') {
                const text = interaction.options.getString('text', true)
                const dateStr = interaction.options.getString('date', true)
                const timeStr = interaction.options.getString('time', true)
                const repeat = interaction.options.getString('repeat', true)
                const [year, month, day] = dateStr.split('-').map(Number)
                const [hour, minute] = timeStr.split(':').map(Number)
                const due = new Date()
                due.setFullYear(year, month - 1, day)
                due.setHours(hour ?? 0, minute ?? 0, 0, 0)
                const ts = due.getTime()
                if (Number.isNaN(ts) || ts <= Date.now()) {
                    return interaction.reply({ content: 'Invalid or past date/time.', ...guildEphemeral(interaction) })
                }
                const id = await addReminder({
                    userId: interaction.user.id,
                    channelId: interaction.channelId, // kept for reference, delivery is DM-only in scheduler
                    guildId: interaction.guildId ?? null,
                    text,
                    timestamp: ts,
                    recur: repeat,
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
                        { name: 'Repeat', value: repeat, inline: true }
                    )
                return interaction.reply({ embeds: [embed], ...guildEphemeral(interaction) })
            }

            if (sub === 'list') {
                const page = interaction.options.getInteger('page') ?? 1
                const { embed, components } = await renderListEmbed(interaction.user, page)
                return interaction.reply({ embeds: [embed], components: interaction.inGuild() ? components : [], ...guildEphemeral(interaction) })
            }

            if (sub === 'delete') {
                const id = interaction.options.getString('id', true)
                const ok = await deleteReminder(id, interaction.user.id)
                if (!ok) return interaction.reply({ content: 'Reminder not found.', ...guildEphemeral(interaction) })
                return interaction.reply({ content: 'Reminder deleted.', ...guildEphemeral(interaction) })
            }

            if (sub === 'edit') {
                const id = interaction.options.getString('id', true)
                const text = interaction.options.getString('text') ?? undefined
                const dateStr = interaction.options.getString('date') ?? undefined
                const timeStr = interaction.options.getString('time') ?? undefined
                const repeat = interaction.options.getString('repeat') ?? undefined
                const ok = await updateReminder(id, interaction.user.id, { text, dateStr, timeStr, repeat })
                if (!ok) return interaction.reply({ content: 'Reminder not found or invalid data.', ...guildEphemeral(interaction) })
                return interaction.reply({ content: 'Reminder updated.', ...guildEphemeral(interaction) })
            }

            if (sub === 'pause') {
                const id = interaction.options.getString('id', true)
                const ok = await pauseReminder(id, interaction.user.id)
                if (!ok) return interaction.reply({ content: 'Reminder not found.', ...guildEphemeral(interaction) })
                return interaction.reply({ content: 'Reminder paused.', ...guildEphemeral(interaction) })
            }

            if (sub === 'resume') {
                const id = interaction.options.getString('id', true)
                const ok = await resumeReminder(id, interaction.user.id)
                if (!ok) return interaction.reply({ content: 'Reminder not found.', ...guildEphemeral(interaction) })
                return interaction.reply({ content: 'Reminder resumed.', ...guildEphemeral(interaction) })
            }
        } catch (e) {
            console.error(`[REMINDER] sub=${sub} error:`, e)
            if (interaction.deferred || interaction.replied) {
                try { await interaction.editReply('There was an error executing this command.') } catch {}
            } else {
                try { await interaction.reply({ content: 'There was an error executing this command.', ...guildEphemeral(interaction) }) } catch {}
            }
        }
    }
}
