import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js'
import { getRandomGif } from '../raaah-store.js'

const WEBHOOK_NAME = 'palas-utility-bot'

async function getOrCreateWebhook(channel, interaction) {
    if (!channel?.fetchWebhooks) return null
    const hooks = await channel.fetchWebhooks()
    const existing = hooks.find(h => h.owner?.id === interaction.client.user.id || h.name === WEBHOOK_NAME)
    if (existing) return existing
    if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageWebhooks)) return null
    return channel.createWebhook({ name: WEBHOOK_NAME })
}

export default {
    data: new SlashCommandBuilder()
        .setName('raaaaaahhhh')
        .setDescription('Envoie un gif aléatoire de la liste'),
    async execute(interaction) {
        const gif = getRandomGif()
        if (!gif) {
            return interaction.reply('La liste est vide. Ajoute un gif avec /addraaaaaahhhh')
        }

        if (!interaction.inGuild()) {
            return interaction.reply(gif)
        }

        try {
            await interaction.deferReply({ ephemeral: true })
            const hook = await getOrCreateWebhook(interaction.channel, interaction)
            if (!hook) {
                return interaction.editReply('Je n’ai pas la permission de gérer les webhooks dans ce salon.')
            }
            const name = (interaction.member?.displayName ?? interaction.user.username).slice(0, 80)
            const avatarURL = interaction.user.displayAvatarURL()
            await hook.send({ content: gif, username: name, avatarURL })
            return interaction.deleteReply().catch(() => {})
        } catch (e) {
            console.error('[RAAAH] webhook send error:', e)
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply('Erreur pendant l’envoi du gif.')
            }
            return interaction.reply('Erreur pendant l’envoi du gif.')
        }
    }
}
