import { SlashCommandBuilder } from 'discord.js'
import { addGif } from '../raaah-store.js'

function isValidUrl(value) {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('addraaaaaahhhh')
        .setDescription('Ajoute un gif à la liste raaah')
        .addStringOption(o => o
            .setName('url')
            .setDescription('Lien du gif')
            .setRequired(true)),
    async execute(interaction) {
        const url = interaction.options.getString('url', true).trim()
        if (!isValidUrl(url)) {
            return interaction.reply('URL invalide. Utilise un lien http(s).')
        }
        const result = addGif(url)
        if (!result.added && result.reason === 'duplicate') {
            return interaction.reply('Ce gif est déjà dans la liste.')
        }
        return interaction.reply(`Gif ajouté. Total: ${result.total}`)
    }
}
