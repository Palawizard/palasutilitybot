# Repository Guidelines

## Project Structure & Module Organization
- `src/index.js` boots the Discord client, loads commands, and starts the reminder scheduler.
- `src/commands/` holds slash command modules (one file per command, e.g., `ping.js`, `reminder.js`). Each module exports `{ data, execute }`.
- `src/scheduler/` contains background services (currently `reminders.js`).
- `src/deploy-commands.js` registers global slash commands with Discord.
- `data/` stores persisted reminder data (`reminders.json`). Treat as user data.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run start` runs the bot locally using `.env` (`TOKEN`, `CLIENT_ID`).
- `npm run deploy` registers slash commands with Discord (run after changing command schemas).

## Coding Style & Naming Conventions
- JavaScript (ES modules). Imports use `import ... from` and files use `.js`.
- Indentation is 4 spaces; no semicolons in existing files.
- Command files: lower-case names, export `default` with `data` (SlashCommandBuilder) and `execute`.
- Scheduler/logging: use `console.log`/`console.error` with tagged prefixes (e.g., `[REM:...]`).
- No formatter or linter is configured; keep style consistent with existing files.

## Testing Guidelines
- No automated tests or test framework are configured.
- If you add tests, document the framework, add a `npm test` script, and use a clear naming pattern (e.g., `*.test.js`).

## Commit & Pull Request Guidelines
- Git history only shows an initial commit, so no strict convention is established.
- Use short, imperative commit subjects (e.g., “add reminder pause command”).
- PRs should include: a brief summary, how you tested (`npm run start`, `npm run deploy`), and any new environment variables or data migrations.

## Security & Configuration Tips
- Keep `.env` out of version control; required keys are `TOKEN` and `CLIENT_ID`.
- `data/reminders.json` contains user content; avoid sharing it and be careful when modifying its format.
