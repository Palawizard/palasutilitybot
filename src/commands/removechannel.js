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

function channelTypeLabel(type) {
    if (type === ChannelType.GuildText) return 'Texte'
    if (type === ChannelType.GuildVoice) return 'Vocal'
    if (type === ChannelType.GuildAnnouncement) return 'Annonce'
    if (type === ChannelType.GuildStageVoice) return 'Stage'
    if (type === ChannelType.GuildForum) return 'Forum'
    return 'Inconnu'
}

export default {
    data: new SlashCommandBuilder()
        .setName('removechannel')
        .setDescription('Lance un vote pour supprimer un salon')
        .setDMPermission(false)
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Salon a supprimer')
            .setRequired(true)
            .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildVoice,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildStageVoice,
                ChannelType.GuildForum
            )),
    async execute(interaction) {
        const guildCheck = guildOnly(interaction)
        if (guildCheck) return interaction.reply(guildCheck)

        await interaction.deferReply()

        const targetChannel = interaction.options.getChannel('channel', true)
        const guild = interaction.guild

        if (!targetChannel.deletable) {
            return interaction.editReply({ content: 'Je n ai pas la permission de supprimer ce salon.' })
        }

        let members
        try {
            members = await guild.members.fetch()
        } catch (e) {
            return interaction.editReply({ content: 'Impossible de recuperer la liste des membres (permission manquante?).' })
        }

        const nonBotMembers = members.filter(m => !m.user.bot)
        const totalVoters = nonBotMembers.size
        const required = Math.ceil(totalVoters / 2)

        const yesId = `rc:yes:${interaction.id}`
        const noId = `rc:no:${interaction.id}`

        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setAuthor({ name: 'Vote: suppression de salon' })
            .setDescription(`Salon a supprimer demande par <@${interaction.user.id}>.`)
            .addFields(
                { name: 'Salon', value: `<#${targetChannel.id}>`, inline: true },
                { name: 'Type', value: channelTypeLabel(targetChannel.type), inline: true },
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
        let deleted = false

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

            if (!deleted && yes >= required) {
                deleted = true
                row.components.forEach(c => c.setDisabled(true))
                collector.stop('passed')

                const sameChannel = targetChannel.id === message.channelId
                if (sameChannel) {
                    embed.addFields({ name: 'Resultat', value: 'Vote accepte. Suppression en cours...', inline: false })
                    embed.setFooter({ text: 'Vote accepte.' })
                    await message.edit({ embeds: [embed], components: [row] }).catch(() => {})
                }

                try {
                    await targetChannel.delete(`Vote removechannel approuve par ${interaction.user.id}`)
                    if (!sameChannel) {
                        embed.addFields({ name: 'Resultat', value: `Salon supprime: #${targetChannel.name}`, inline: false })
                        embed.setFooter({ text: 'Vote accepte.' })
                        await message.edit({ embeds: [embed], components: [row] })
                    }
                } catch (e) {
                    embed.addFields({ name: 'Resultat', value: 'Vote accepte, mais suppression impossible (permissions?).', inline: false })
                    embed.setFooter({ text: 'Vote accepte.' })
                    await message.edit({ embeds: [embed], components: [row] }).catch(() => {})
                }
                return
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
