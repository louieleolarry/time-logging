import { Router } from 'express';
import { spawn } from 'child_process';
import os from 'os';

const router = Router();

// POST /api/install
// Body: { sources: string[] }
// Streams install progress via Server-Sent Events
router.post('/', (req, res) => {
  const { sources = [] } = req.body;
  const approach = 'claude-cron';

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const uvBin = `${os.homedir()}/.local/bin/uv`;
  const pip3 = '/usr/bin/pip3';

  // Build install steps based on selections
  const steps = [];

  // mcp-atlassian is always needed
  steps.push({
    label: 'Installing mcp-atlassian...',
    cmd: uvBin,
    args: ['tool', 'install', 'mcp-atlassian'],
  });

  if (sources.includes('mac-notes')) {
    steps.push({
      label: 'Installing macnotesapp (Mac Notes support)...',
      cmd: pip3,
      args: ['install', 'macnotesapp'],
    });
  }

  if (sources.includes('google-sheets') || sources.includes('google-docs')) {
    steps.push({
      label: 'Installing Google API client libraries...',
      cmd: pip3,
      args: ['install', 'google-api-python-client', 'google-auth-httplib2', 'google-auth-oauthlib'],
    });
  }

  // Always check for Claude Code CLI
  steps.push({
    label: 'Checking for Claude Code CLI...',
    cmd: 'which',
    args: ['claude'],
  });

  let stepIndex = 0;

  const runNext = () => {
    if (stepIndex >= steps.length) {
      send('done', { message: 'All dependencies installed successfully.' });
      res.end();
      return;
    }

    const step = steps[stepIndex++];
    send('step', { label: step.label, index: stepIndex, total: steps.length });

    const proc = spawn(step.cmd, step.args, {
      env: { ...process.env, HOME: os.homedir() },
    });

    proc.stdout.on('data', (d) => send('stdout', { text: d.toString() }));
    proc.stderr.on('data', (d) => send('stderr', { text: d.toString() }));

    proc.on('close', (code) => {
      if (code !== 0 && step.cmd !== 'which') {
        send('error', { label: step.label, code });
        // Continue anyway — user can retry
      } else {
        send('success', { label: step.label });
      }
      runNext();
    });

    proc.on('error', (err) => {
      send('error', { label: step.label, message: err.message });
      runNext();
    });
  };

  runNext();
});

export default router;
