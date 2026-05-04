import { Router } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const router = Router();

function probe(cmd) {
  try { execSync(cmd, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function probeVersion(cmd) {
  try { return execSync(cmd, { stdio: 'pipe' }).toString().trim(); }
  catch { return null; }
}

router.get('/', (_req, res) => {
  const configPath = path.join(os.homedir(), '.jira-time-tracker', 'config.json');
  let existingConfig = null;
  try {
    existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}

  res.json({
    tools: {
      node: probeVersion('node --version'),
      python3: probeVersion('/usr/bin/python3 --version'),
      uv: probeVersion('uv --version') || probeVersion(`${os.homedir()}/.local/bin/uv --version`),
      brew: probe('which brew'),
      git: probeVersion('git --version'),
      macnotesapp: probe('/usr/bin/python3 -c "import macnotesapp"'),
      requests: probe('/usr/bin/python3 -c "import requests"'),
      googleApiClient: probe('/usr/bin/python3 -c "import googleapiclient"'),
    },
    existingConfig,
    configPath,
    platform: process.platform,
    arch: process.arch,
    homeDir: os.homedir(),
  });
});

export default router;
