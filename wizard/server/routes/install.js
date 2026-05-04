import { Router } from 'express';
import { spawn } from 'child_process';
import os from 'os';

const router = Router();

// POST /api/install
// Body: { sources: string[] }
// Streams install progress via Server-Sent Events
router.post('/', (req, res) => {
  const { sources = [] } = req.body;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const pip3 = '/usr/bin/pip3';

  // Build install steps based on selections
  const steps = [];

  // requests is always needed for the Jira REST API calls
  steps.push({
    label: 'Installing requests (Jira REST API client)...',
    cmd: pip3,
    args: ['install', 'requests'],
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
      if (code !== 0) {
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
