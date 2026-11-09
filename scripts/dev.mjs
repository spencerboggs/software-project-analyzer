import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ server: { port: 5273, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';

console.log(`[software-project-analyzer] renderer at ${url}`);

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
});

const shutdown = async () => {
  try {
    await server.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
};

child.on('close', shutdown);
process.on('SIGINT', () => {
  child.kill();
  shutdown();
});
process.on('SIGTERM', () => {
  child.kill();
  shutdown();
});
