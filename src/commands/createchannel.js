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

function normalizeTextChannelName(name) {
    const base = name.trim().toLowerCase()
    const cleaned = base.replace(/[^a-z0-9-_\s]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    return cleaned || 'nouveau-salon'
}

function typeLabel(type) {
    return type === 'voice' ? 'Vocal' : 'Texte'
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
        console.error('[CC] button reply failed', e)
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('createchannel')
        .setDescription('Lance un vote pour créer un salon')
        .setDMPermission(false)
        .addStringOption(o => o
            .setName('nom')
            .setDescription('Nom du salon à créer')
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
            .setDescription('Catégorie cible')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)),
    async execute(interaction) {
        try {
            const guildCheck = guildOnly(interaction)
            if (guildCheck) return interaction.reply(guildCheck)

            await interaction.deferReply()
            console.log('[CC] deferred reply')

            const rawName = interaction.options.getString('nom', true)
            const requestedType = interaction.options.getString('type', true)
            const category = interaction.options.getChannel('category', true)
            const guild = interaction.guild

            console.log(`[CC] start guild=${guild?.id} user=${interaction.user.id} rawName="${rawName}" type=${requestedType} category=${category?.id}`)

            let members
            let membersSource = 'fetch'
            try {
                members = await Promise.race([
                    guild.members.fetch(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('members fetch timeout')), 10000))
                ])
            } catch (e) {
                console.error('[CC] members fetch failed', e)
                members = guild.members.cache
                membersSource = 'cache'
                if (!members?.size) {
                    return interaction.editReply({ content: 'Impossible de récupérer la liste des membres (permission manquante ?).' })
                }
            }

            const nonBotMembers = members.filter(m => !m.user.bot)
            const totalVoters = nonBotMembers.size
            const required = Math.ceil(totalVoters / 2)
            console.log(`[CC] members source=${membersSource} voters total=${totalVoters} required=${required}`)

            const channelName = requestedType === 'text' ? normalizeTextChannelName(rawName) : rawName.trim()
            const categoryLabel = `<#${category.id}>`
            const yesId = `cc:yes:${interaction.id}`
            const noId = `cc:no:${interaction.id}`
            const existingChannel = guild.channels.cache.find(ch => ch.name === channelName && ch.parentId === category.id)
            if (existingChannel) {
                console.log(`[CC] existing channel name="${channelName}" id=${existingChannel.id}`)
            }

            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({ name: 'Vote: création de salon' })
                .setDescription(`Salon demandé par <@${interaction.user.id}>.`)
                .addFields(
                    { name: 'Nom', value: channelName, inline: true },
                    { name: 'Type', value: typeLabel(requestedType), inline: true },
                    { name: 'Catégorie', value: categoryLabel, inline: true },
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
                console.log('[CC] message posted')
            } catch (e) {
                console.error('[CC] initial reply failed', e)
                return
            }

            let message
            try {
                message = await interaction.fetchReply()
                console.log('[CC] message fetched')
            } catch (e) {
                console.error('[CC] fetch reply failed', e)
                return
            }

            const voters = new Map()
            let yes = 0
            let no = 0
            let created = false
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
                    console.error('[CC] message update failed', e)
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
                    console.error('[CC] finalize update failed', e)
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
                    if (created || rejected) {
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

                    console.log(`[CC] vote user=${buttonInteraction.user.id} previous=${previous ?? 'none'} next=${next} yes=${yes} no=${no}`)
                    await safeButtonReply(buttonInteraction, previous ? 'Vote mis à jour.' : 'Vote enregistré.')

                    if (!created && yes >= required) {
                        created = true
                        finalStatusText = 'Vote accepté.'
                        collector.stop('passed')

                        try {
                            const channelType = requestedType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText
                            const channel = await guild.channels.create({
                                name: channelName,
                                type: channelType,
                                parent: category?.id
                            })
                            console.log(`[CC] channel created id=${channel.id}`)
                            finalResultText = `Salon créé : <#${channel.id}>`
                            await applyFinalState()
                        } catch (e) {
                            console.error('[CC] channel create failed', e)
                            finalResultText = 'Vote accepté, mais création du salon impossible (permissions ?).'
                            await applyFinalState()
                        }
                        return
                    }

                    if (!rejected && no >= required) {
                        rejected = true
                        finalStatusText = 'Vote refusé.'
                        finalResultText = 'Vote refusé.'
                        collector.stop('rejected')
                        console.log(`[CC] vote rejected yes=${yes} no=${no}`)
                        await applyFinalState()
                        return
                    }

                    return updateMessage()
                } catch (e) {
                    console.error('[CC] collect handler failed', e)
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
                    console.log(`[CC] collector ended reason=${reason} yes=${yes} no=${no}`)
                } catch (e) {
                    console.error('[CC] collector end failed', e)
                }
            })
        } catch (e) {
            console.error('[CC] execute failed', e)
            const errorReply = { content: 'Une erreur est survenue.', flags: 64 }
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(errorReply).catch(() => {})
            } else {
                await interaction.reply(errorReply).catch(() => {})
            }
        }
    }
}
