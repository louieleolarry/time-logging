import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const router = Router();

// POST /api/config — write config.json
router.post('/', (req, res) => {
  const config = req.body;
  const dir = path.join(os.homedir(), '.jira-time-tracker');
  const configPath = path.join(dir, 'config.json');

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ ok: true, configPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/config — read existing config
router.get('/', (_req, res) => {
  const configPath = path.join(os.homedir(), '.jira-time-tracker', 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({ ok: true, config });
  } catch {
    res.json({ ok: false, config: null });
  }
});

export default router;
