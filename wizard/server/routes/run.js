import { Router } from 'express';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';

const router = Router();

const SCRIPT = path.join(os.homedir(), 'Applications', 'JiraTimeTracker', 'wizard', 'log-time.py');
const PYTHON = '/usr/bin/python3';

router.post('/', (req, res) => {
  const { args = [] } = req.body;

  const allowed = ['--dry-run', '--no-post', '--source', '--date'];
  const safe = args.filter(a => allowed.some(f => a === f || a.startsWith(f + '=')));

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const cmdArgs = [SCRIPT, ...safe];
  console.log(`[run] spawn: ${PYTHON} ${cmdArgs.join(' ')}`);

  const child = spawn(PYTHON, cmdArgs, {
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: os.homedir(),
  });

  child.stdout.on('data', chunk => {
    res.write(chunk);
  });

  child.stderr.on('data', chunk => {
    res.write(chunk);
  });

  child.on('close', (code, signal) => {
    console.log(`[run] exited code=${code} signal=${signal}`);
    res.write(`\n--- exited ${code ?? signal} ---\n`);
    res.end();
  });

  child.on('error', err => {
    console.error(`[run] error: ${err.message}`);
    res.write(`\nError: ${err.message}\n`);
    res.end();
  });

  res.on('close', () => {
    if (!child.killed) child.kill();
  });
});

export default router;
