import { Router } from 'express';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WIZARD_DIR = path.resolve(__dirname, '..', '..');

// POST /api/run
// Body: { mode: "dry-run" | "run" | "run-date", date?: "YYYY-MM-DD", since?: number }
// Streams log-time.py output via Server-Sent Events
router.post('/', (req, res) => {
  const { mode = 'dry-run', date, since } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  const logTimePy = path.join(WIZARD_DIR, 'log-time.py');
  const args = [logTimePy];

  if (mode === 'dry-run') {
    args.push('--dry-run');
  } else if (mode === 'run-date' && date) {
    args.push('--date', date);
  }

  if (since != null) {
    args.push('--since', String(since));
  }

  send('start', { label: `Running log-time.py ${args.slice(1).join(' ')}`.trim() });

  const proc = spawn('/usr/bin/python3', args, {
    env: {
      ...process.env,
      HOME: os.homedir(),
      PATH: `/usr/local/bin:/usr/bin:/bin:${os.homedir()}/.local/bin`,
    },
    cwd: WIZARD_DIR,
  });

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      send('stdout', { text: line });
    }
  });

  proc.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      send('stderr', { text: line });
    }
  });

  proc.on('close', (code) => {
    send('done', { code, message: code === 0 ? 'Completed successfully.' : `Exited with code ${code}` });
    res.end();
  });

  proc.on('error', (err) => {
    send('error', { message: err.message });
    res.end();
  });

  req.on('close', () => {
    proc.kill();
  });
});

export default router;
