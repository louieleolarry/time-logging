import { Router } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

const LABEL = 'com.jira-time-tracker.daily';

// The wizard root is two directories above this file: wizard/server/routes/ → wizard/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_WIZARD_DIR = path.resolve(__dirname, '..', '..');

// POST /api/launchd
// Body: { time: "17:30", days: ["Mon","Tue","Wed","Thu","Fri"] }
router.post('/', (req, res) => {
  const { time = '17:30', days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] } = req.body;
  const [hour, minute] = time.split(':').map(Number);

  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdays = days.map((d) => dayMap[d]).filter((d) => d !== undefined);

  const homeDir = os.homedir();
  const logDir = path.join(homeDir, '.jira-time-tracker', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  // Always derive the wizard directory from the server's own location —
  // never trust a client-supplied path, and avoid the broken import.meta.url fallback.
  const resolvedWizardDir = SERVER_WIZARD_DIR;
  const logTimePy = path.join(resolvedWizardDir, 'log-time.py');

  // Find python3 — prefer /usr/bin/python3 (macOS system Python with macnotesapp)
  let pythonPath = '/usr/bin/python3';
  try {
    const which = execSync('which python3', { stdio: 'pipe' }).toString().trim();
    if (which) pythonPath = which;
  } catch {}

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${pythonPath}</string>
    <string>${logTimePy}</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${weekdays.map((d) => `    <dict>
      <key>Weekday</key>
      <integer>${d}</integer>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>${minute}</integer>
    </dict>`).join('\n')}
  </array>
  <key>StandardOutPath</key>
  <string>${logDir}/jira-time-tracker.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/jira-time-tracker-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${homeDir}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${homeDir}/.local/bin</string>
  </dict>
</dict>
</plist>`;

  const plistDir = path.join(homeDir, 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, `${LABEL}.plist`);

  try {
    fs.mkdirSync(plistDir, { recursive: true });
    fs.writeFileSync(plistPath, plistContent, 'utf8');

    // Unload if already loaded (ignore errors)
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}

    // Load the new plist
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });

    res.json({ ok: true, plistPath, pythonPath, logTimePy, schedule: { time, days } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/launchd — unload and remove
router.delete('/', (_req, res) => {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  try {
    try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}
    fs.unlinkSync(plistPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
