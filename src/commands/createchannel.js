import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ComponentType
} from 'discord.js'

const voteDurationMs = 24 * 60 * 60 * 1000

function guildOnly(interaction) {
    return interaction.inGuild() ? null : { content: 'Cette commande doit etre utilisee sur un serveur.', flags: 64 }
}

function normalizeTextChannelName(name) {
    const base = name.trim().toLowerCase()
    const cleaned = base.replace(/[^a-z0-9-_\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    return cleaned || 'nouveau-salon'
}

function typeLabel(type) {
    return type === 'voice' ? 'Vocal' : 'Texte'
}

export default {
    data: new SlashCommandBuilder()
        .setName('createchannel')
        .setDescription('Lance un vote pour creer un salon')
        .setDMPermission(false)
        .addStringOption(o => o
            .setName('nom')
            .setDescription('Nom du salon a creer')
            .setRequired(true))
        .addStringOption(o => o
            .setName('type')
            .setDescription('Type de salon')
            .setRequired(true)
            .addChoices(
                { name: 'text', value: 'text' },
                { name: 'voice', value: 'voice' }
            ))
        .addChannelOption(o => o
            .setName('category')
            .setDescription('Categorie cible')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)),
    async execute(interaction) {
        const guildCheck = guildOnly(interaction)
        if (guildCheck) return interaction.reply(guildCheck)

        await interaction.deferReply()

        const rawName = interaction.options.getString('nom', true)
        const requestedType = interaction.options.getString('type', true)
        const category = interaction.options.getChannel('category', true)
        const guild = interaction.guild

        let members
        try {
            members = await guild.members.fetch()
        } catch (e) {
            return interaction.editReply({ content: 'Impossible de recuperer la liste des membres (permission manquante?).' })
        }

        const nonBotMembers = members.filter(m => !m.user.bot)
        const totalVoters = nonBotMembers.size
        const required = Math.ceil(totalVoters / 2)

        const channelName = requestedType === 'text' ? normalizeTextChannelName(rawName) : rawName.trim()
        const categoryLabel = `<#${category.id}>`
        const yesId = `cc:yes:${interaction.id}`
        const noId = `cc:no:${interaction.id}`

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setAuthor({ name: 'Vote: creation de salon' })
            .setDescription(`Salon demande par <@${interaction.user.id}>.`)
            .addFields(
                { name: 'Nom', value: channelName, inline: true },
                { name: 'Type', value: typeLabel(requestedType), inline: true },
                { name: 'Categorie', value: categoryLabel, inline: true },
                { name: 'Seuil', value: `${required} / ${totalVoters} votes`, inline: true },
                { name: 'Votes', value: ':white_check_mark: 0 | :x: 0', inline: true }
            )
            .setFooter({ text: 'Vote ouvert pendant 24 heures.' })

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(yesId).setLabel('Accepter').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(noId).setLabel('Refuser').setStyle(ButtonStyle.Danger)
        )

        await interaction.editReply({ embeds: [embed], components: [row] })
        const message = await interaction.fetchReply()

        const voters = new Set()
        let yes = 0
        let no = 0
        let created = false

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: voteDurationMs
        })

        const updateMessage = async (statusText) => {
            embed.spliceFields(3, 1, { name: 'Votes', value: `:white_check_mark: ${yes} | :x: ${no}`, inline: true })
            if (statusText) embed.setFooter({ text: statusText })
            await message.edit({ embeds: [embed], components: [row] })
        }

        collector.on('collect', async buttonInteraction => {
            if (buttonInteraction.user.bot) {
                return buttonInteraction.reply({ content: 'Les bots ne votent pas.', flags: 64 })
            }
            if (!nonBotMembers.has(buttonInteraction.user.id)) {
                return buttonInteraction.reply({ content: 'Tu dois etre membre du serveur pour voter.', flags: 64 })
            }
            if (voters.has(buttonInteraction.user.id)) {
                return buttonInteraction.reply({ content: 'Tu as deja vote.', flags: 64 })
            }

            voters.add(buttonInteraction.user.id)
            if (buttonInteraction.customId === yesId) yes += 1
            if (buttonInteraction.customId === noId) no += 1

            await buttonInteraction.reply({ content: 'Vote enregistre.', flags: 64 })

            if (!created && yes >= required) {
                created = true
                row.components.forEach(c => c.setDisabled(true))
                collector.stop('passed')

                try {
                    const channelType = requestedType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText
                    const channel = await guild.channels.create({
                        name: channelName,
                        type: channelType,
                        parent: category?.id
                    })
                    embed.addFields({ name: 'Resultat', value: `Salon cree: <#${channel.id}>`, inline: false })
                    embed.setFooter({ text: 'Vote accepte.' })
                } catch (e) {
                    embed.addFields({ name: 'Resultat', value: 'Vote accepte, mais creation du salon impossible (permissions?).', inline: false })
                    embed.setFooter({ text: 'Vote accepte.' })
                }
                return message.edit({ embeds: [embed], components: [row] })
            }

            return updateMessage()
        })

        collector.on('end', async (_collected, reason) => {
            if (reason !== 'passed') {
                row.components.forEach(c => c.setDisabled(true))
                await updateMessage('Vote termine.')
            }
        })
    }
}
