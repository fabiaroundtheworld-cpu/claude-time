// One-time setup. Clone this repo to %USERPROFILE%\.claude\timetrack, then run:  node install.mjs
// Idempotent: running it again changes nothing.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// 1. Start the computer/Chrome logger hidden at every logon, and now (tracker.ps1 exits if already running).
const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbs = path.join(startup, 'claude-timetrack.vbs');
const ps1 = path.join(root, 'tracker.ps1');
fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1}""", 0, False\r\n`);
spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore' }).unref();

// 2. Load the mod in every Claude Code session.
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
settings.env ??= {};
const mod = path.join(root, 'mod').split(path.sep).join('/');
const dirs = (settings.env.CLAUDE_CODE_PLUGIN_DIRS || '').split(';').filter((d) => d && d !== mod);
settings.env.CLAUDE_CODE_PLUGIN_DIRS = [...dirs, mod].join(';');
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log(`Logger: ${vbs}\nMod: ${mod}\nDone. Restart Claude Code, then run /cludetime.`);
