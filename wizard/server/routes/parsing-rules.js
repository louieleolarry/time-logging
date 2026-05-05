import { Router } from 'express';
import { execFile, exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Locate the `claude` binary — check common install paths on macOS
function findClaudeBin(callback) {
  const candidates = [
    'claude',
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    `${os.homedir()}/.npm-global/bin/claude`,
    `${os.homedir()}/.local/bin/claude`,
  ];

  // Try PATH first
  exec('which claude', (err, stdout) => {
    if (!err && stdout.trim()) return callback(null, stdout.trim());

    // Try each candidate
    for (const c of candidates) {
      try {
        if (fs.existsSync(c)) return callback(null, c);
      } catch { /* skip */ }
    }

    callback(new Error('claude CLI not found. Make sure Claude Code is installed (npm install -g @anthropic-ai/claude-code).'));
  });
}

// POST /api/parsing-rules/analyze
// Uses `claude -p` (Claude Code non-interactive mode) to analyze the note and suggest rules.
router.post('/analyze', (req, res) => {
  const { note_text, current_rules, charge_codes } = req.body || {};

  if (!note_text || typeof note_text !== 'string') {
    return res.json({ suggestions: [], summary: '', error: 'No note text provided.' });
  }

  const currentSkip = (current_rules?.skip_patterns || []).join(', ') || 'none';
  const currentMappings = (current_rules?.keyword_mappings || [])
    .map((m) => `${m.keyword} → ${m.key}`)
    .join(', ') || 'none';

  const prompt = `You are a parsing rules assistant for a Jira time-tracking tool.
Analyze the following time log note and suggest parsing rules to improve accuracy.

TIME LOG NOTE:
${note_text}

CURRENT SKIP PATTERNS ALREADY CONFIGURED: ${currentSkip}
CURRENT KEYWORD MAPPINGS ALREADY CONFIGURED: ${currentMappings}

Return ONLY valid JSON in this exact format (no markdown, no explanation, just JSON):
{
  "summary": "one sentence summary of what you found",
  "suggestions": [
    {
      "type": "skip_pattern",
      "value": "the pattern string (lowercase)",
      "reason": "why this block should be skipped"
    },
    {
      "type": "keyword_mapping",
      "value": "the keyword string (lowercase)",
      "key": "JIRA-KEY",
      "label": "optional human label",
      "reason": "why this keyword maps to this key"
    }
  ]
}

Rules:
- Suggest skip_pattern for blocks that are clearly NOT work (lunch, breaks, personal notes, non-billable items with no Jira key)
- Suggest keyword_mapping ONLY when a block has no Jira key on its first line but has a recognizable keyword that could map to a Jira key visible elsewhere in the note
- Do NOT suggest patterns already in the current configured lists
- Do NOT suggest skip_pattern for blocks that already have a Jira key
- Keep patterns short and specific (e.g. "lunch" not "lunch in-house chicken")
- If no suggestions are needed, return an empty suggestions array
- Return at most 8 suggestions total`;

  findClaudeBin((binErr, claudeBin) => {
    if (binErr) {
      return res.json({
        suggestions: [],
        summary: '',
        error: `Claude Code not found: ${binErr.message}`,
      });
    }

    execFile(
      claudeBin,
      ['-p', prompt],
      { timeout: 45000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          return res.json({
            suggestions: [],
            summary: '',
            error: `Claude Code error: ${stderr || err.message}`,
          });
        }

        // Extract JSON from response (handle any surrounding text)
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return res.json(result);
          }
        } catch { /* fall through */ }

        return res.json({
          suggestions: [],
          summary: '',
          error: 'Could not parse Claude response as JSON.',
        });
      }
    );
  });
});

// POST /api/parsing-rules/save — merge parsing_rules into existing config
router.post('/save', (req, res) => {
  const { parsing_rules } = req.body || {};
  const configPath = path.join(os.homedir(), '.jira-time-tracker', 'config.json');
  try {
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* new config */ }
    config.parsing_rules = parsing_rules;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
