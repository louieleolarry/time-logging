import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const router = Router();
const CONFIG_PATH = path.join(os.homedir(), '.jira-time-tracker', 'config.json');

// POST /api/config/sample-note  { sample_note: string }
// Saves the sample note to config.json for reference/debugging.
router.post('/', (req, res) => {
  const { sample_note } = req.body || {};
  if (!sample_note || typeof sample_note !== 'string') {
    return res.json({ ok: true }); // non-blocking, just skip
  }
  try {
    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    config.sample_note = sample_note;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // non-blocking
  }
});

export default router;
