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
    return interaction.inGuild() ? null : { content: 'Cette commande doit être utilisée sur un serveur.', flags: 64 }
}

function channelTypeLabel(type) {
    if (type === ChannelType.GuildText) return 'Texte'
    if (type === ChannelType.GuildVoice) return 'Vocal'
    if (type === ChannelType.GuildAnnouncement) return 'Annonce'
    if (type === ChannelType.GuildStageVoice) return 'Stage'
    if (type === ChannelType.GuildForum) return 'Forum'
    return 'Inconnu'
}

function updateVotesField(embed, yes, no) {
    const fields = embed.data.fields ?? []
    const votesIndex = fields.findIndex(field => field.name === 'Votes')
    const votesField = { name: 'Votes', value: `:white_check_mark: ${yes} | :x: ${no}`, inline: true }
    if (votesIndex === -1) {
        embed.addFields(votesField)
    } else {
        embed.spliceFields(votesIndex, 1, votesField)
    }
}

function updateResultField(embed, value) {
    const fields = embed.data.fields ?? []
    const resultIndex = fields.findIndex(field => field.name === 'Résultat' || field.name === 'Resultat')
    const resultField = { name: 'Résultat', value, inline: false }
    if (resultIndex === -1) {
        embed.addFields(resultField)
    } else {
        embed.spliceFields(resultIndex, 1, resultField)
    }
}

async function safeButtonReply(buttonInteraction, content) {
    try {
        await buttonInteraction.reply({ content, flags: 64 })
    } catch (e) {
        console.error('[RC] button reply failed', e)
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('removechannel')
        .setDescription('Lance un vote pour supprimer un salon')
        .setDMPermission(false)
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Salon à supprimer')
            .setRequired(true)
            .addChannelTypes(
                ChannelType.GuildText,
                ChannelType.GuildVoice,
                ChannelType.GuildAnnouncement,
                ChannelType.GuildStageVoice,
                ChannelType.GuildForum
            )),
    async execute(interaction) {
        try {
            const guildCheck = guildOnly(interaction)
            if (guildCheck) return interaction.reply(guildCheck)

            await interaction.deferReply()
            console.log('[RC] deferred reply')

            const targetChannel = interaction.options.getChannel('channel', true)
            const guild = interaction.guild

            console.log(`[RC] start guild=${guild?.id} user=${interaction.user.id} channel=${targetChannel?.id}`)

            if (!targetChannel.deletable) {
                console.log(`[RC] channel not deletable id=${targetChannel.id}`)
                return interaction.editReply({ content: 'Je n\'ai pas la permission de supprimer ce salon.' })
            }

            let members
            let membersSource = 'fetch'
            try {
                members = await Promise.race([
                    guild.members.fetch(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('members fetch timeout')), 10000))
                ])
            } catch (e) {
                console.error('[RC] members fetch failed', e)
                members = guild.members.cache
                membersSource = 'cache'
                if (!members?.size) {
                    return interaction.editReply({ content: 'Impossible de récupérer la liste des membres (permission manquante ?).' })
                }
            }

            const nonBotMembers = members.filter(m => !m.user.bot)
            const totalVoters = nonBotMembers.size
            const required = Math.ceil(totalVoters / 2)
            console.log(`[RC] members source=${membersSource} voters total=${totalVoters} required=${required}`)

            const yesId = `rc:yes:${interaction.id}`
            const noId = `rc:no:${interaction.id}`

            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({ name: 'Vote: suppression de salon' })
                .setDescription(`Salon à supprimer demandé par <@${interaction.user.id}>.`)
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

            try {
                await interaction.editReply({ embeds: [embed], components: [row] })
                console.log('[RC] message posted')
            } catch (e) {
                console.error('[RC] initial reply failed', e)
                return
            }

            let message
            try {
                message = await interaction.fetchReply()
                console.log('[RC] message fetched')
            } catch (e) {
                console.error('[RC] fetch reply failed', e)
                return
            }

            const voters = new Map()
            let yes = 0
            let no = 0
            let deleted = false
            let rejected = false
            let finalStatusText = null
            let finalResultText = null

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: voteDurationMs
            })

            const updateMessage = async (statusText) => {
                updateVotesField(embed, yes, no)
                if (statusText) embed.setFooter({ text: statusText })
                try {
                    await message.edit({ embeds: [embed], components: [row] })
                } catch (e) {
                    console.error('[RC] message update failed', e)
                }
            }

            const applyFinalState = async () => {
                updateVotesField(embed, yes, no)
                if (finalResultText) updateResultField(embed, finalResultText)
                if (finalStatusText) embed.setFooter({ text: finalStatusText })
                row.components.forEach(c => c.setDisabled(true))
                try {
                    await message.edit({ embeds: [embed], components: [row] })
                } catch (e) {
                    console.error('[RC] finalize update failed', e)
                }
            }

            collector.on('collect', async buttonInteraction => {
                try {
                    if (buttonInteraction.user.bot) {
                        await safeButtonReply(buttonInteraction, 'Les bots ne votent pas.')
                        return
                    }
                    if (!nonBotMembers.has(buttonInteraction.user.id)) {
                        await safeButtonReply(buttonInteraction, 'Tu dois être membre du serveur pour voter.')
                        return
                    }
                    if (deleted || rejected) {
                        await safeButtonReply(buttonInteraction, 'Le vote est terminé.')
                        return
                    }

                    const previous = voters.get(buttonInteraction.user.id)
                    const next = buttonInteraction.customId === yesId ? 'yes' : 'no'
                    if (previous === next) {
                        await safeButtonReply(buttonInteraction, 'Tu as déjà voté pour ce choix.')
                        return
                    }
                    if (previous === 'yes') yes -= 1
                    if (previous === 'no') no -= 1
                    voters.set(buttonInteraction.user.id, next)
                    if (next === 'yes') yes += 1
                    if (next === 'no') no += 1

                    console.log(`[RC] vote user=${buttonInteraction.user.id} previous=${previous ?? 'none'} next=${next} yes=${yes} no=${no}`)
                    await safeButtonReply(buttonInteraction, previous ? 'Vote mis à jour.' : 'Vote enregistré.')

                    if (!deleted && yes >= required) {
                        deleted = true
                        finalStatusText = 'Vote accepté.'
                        collector.stop('passed')

                        const sameChannel = targetChannel.id === message.channelId
                        if (sameChannel) {
                            finalResultText = 'Vote accepté. Suppression en cours...'
                            await applyFinalState()
                        }

                        try {
                            console.log(`[RC] deleting channel id=${targetChannel.id}`)
                            await targetChannel.delete(`Vote removechannel approuvé par ${interaction.user.id}`)
                            if (!sameChannel) {
                                finalResultText = `Salon supprimé : #${targetChannel.name}`
                                await applyFinalState()
                            }
                        } catch (e) {
                            console.error('[RC] channel delete failed', e)
                            finalResultText = 'Vote accepté, mais suppression impossible (permissions ?).'
                            await applyFinalState()
                        }
                        return
                    }

                    if (!rejected && no >= required) {
                        rejected = true
                        finalStatusText = 'Vote refusé.'
                        finalResultText = 'Vote refusé.'
                        collector.stop('rejected')
                        console.log(`[RC] vote rejected yes=${yes} no=${no}`)
                        await applyFinalState()
                        return
                    }

                    return updateMessage()
                } catch (e) {
                    console.error('[RC] collect handler failed', e)
                    if (!buttonInteraction.replied && !buttonInteraction.deferred) {
                        await buttonInteraction.reply({ content: 'Une erreur est survenue.', flags: 64 }).catch(() => {})
                    }
                }
            })

            collector.on('end', async (_collected, reason) => {
                try {
                    if (reason !== 'passed' && reason !== 'rejected') {
                        row.components.forEach(c => c.setDisabled(true))
                        await updateMessage('Vote terminé.')
                    }
                    if (reason === 'rejected' || reason === 'passed') {
                        await applyFinalState()
                    }
                    console.log(`[RC] collector ended reason=${reason} yes=${yes} no=${no}`)
                } catch (e) {
                    console.error('[RC] collector end failed', e)
                }
            })
        } catch (e) {
            console.error('[RC] execute failed', e)
            const errorReply = { content: 'Une erreur est survenue.', flags: 64 }
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(errorReply).catch(() => {})
            } else {
                await interaction.reply(errorReply).catch(() => {})
            }
        }
    }
}
