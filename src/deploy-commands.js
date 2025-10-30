import { REST, Routes } from 'discord.js'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const commands = []
const commandsPath = path.join(process.cwd(), 'src', 'commands')
for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const fileUrl = pathToFileURL(path.join(commandsPath, file)).href
    const mod = await import(fileUrl)
    const command = mod.default ?? mod
    if (command.data && command.execute) {
        commands.push(command.data.toJSON())
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN)
await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
)
console.log('Global slash commands deployed.')
