import { Router } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// POST /api/parse-preview  { text: string }
// Runs log-time.py --dry-run with the provided text as a temp stickies file
// and returns parsed entries as JSON.
router.post('/', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.json({ entries: [], date: null, error: 'No text provided.' });
  }

  // Write text to a temp file
  const tmpFile = path.join(os.tmpdir(), `jtt-preview-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, text, 'utf8');

  const scriptDir = path.resolve(__dirname, '..', '..');
  const logTimePy = path.join(scriptDir, 'log-time.py');

  execFile(
    '/usr/bin/python3',
    [logTimePy, '--dry-run', '--preview-file', tmpFile],
    { timeout: 15000 },
    (err, stdout, stderr) => {
      fs.unlink(tmpFile, () => {});
      if (err && !stdout) {
        return res.json({ entries: [], date: null, error: stderr || err.message });
      }
      // Parse the JSON output from --preview-file mode
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return res.json(parsed);
        }
      } catch { /* fall through */ }
      return res.json({ entries: [], date: null, error: 'Could not parse output.' });
    }
  );
});

export default router;
