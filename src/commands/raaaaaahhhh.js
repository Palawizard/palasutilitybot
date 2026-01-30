import { SlashCommandBuilder } from 'discord.js'
import { getRandomGif } from '../raaah-store.js'

export default {
    data: new SlashCommandBuilder()
        .setName('raaaaaahhhh')
        .setDescription('Envoie un gif aléatoire de la liste'),
    async execute(interaction) {
        const gif = getRandomGif()
        if (!gif) {
            return interaction.reply('La liste est vide. Ajoute un gif avec /addraaaaaahhhh')
        }
        return interaction.reply(gif)
    }
}
