import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js'

function scheduleDelete(message) {
    setTimeout(() => {
        message.delete().catch(() => {})
    }, 3000)
}

export default {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Supprime un nombre de messages récents dans ce salon')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(o => o
            .setName('nombre')
            .setDescription('Nombre de messages à supprimer (1-100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)),
    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.channel || !interaction.channel.bulkDelete) {
            const msg = await interaction.reply({ content: 'Cette commande doit être utilisée dans un salon texte.', fetchReply: true })
            scheduleDelete(msg)
            return
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            const msg = await interaction.reply({ content: 'Tu n’as pas la permission de gérer les messages.', fetchReply: true })
            scheduleDelete(msg)
            return
        }

        if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageMessages)) {
            const msg = await interaction.reply({ content: 'Je n’ai pas la permission de gérer les messages.', fetchReply: true })
            scheduleDelete(msg)
            return
        }

        const count = interaction.options.getInteger('nombre', true)
        try {
            const deleted = await interaction.channel.bulkDelete(count, true)
            const msg = await interaction.reply({ content: `Supprimé ${deleted.size} message(s).`, fetchReply: true })
            scheduleDelete(msg)
        } catch (e) {
            console.error(`[PURGE] error:`, e)
            const msg = await interaction.reply({ content: 'Erreur pendant la suppression des messages.', fetchReply: true })
            scheduleDelete(msg)
        }
    }
}
