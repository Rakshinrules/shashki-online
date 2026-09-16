import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const data = `PLAYER_TOKEN=${randomBytes(32).toString('hex')}\nAGENT_TOKEN=${randomBytes(32).toString('hex')}\nHOST=127.0.0.1\nPORT=3077\nDB_PATH=events.sqlite\nPUBLIC_ORIGIN=\n`;
writeFileSync(new URL('.env', import.meta.url), data, { mode: 0o600, flag: 'wx' });
console.log('Created .env with independent random tokens. Existing configuration is never overwritten.');
