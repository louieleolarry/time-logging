import { Router } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// POST /api/parsing-rules/analyze
// Sends the note text + current rules to Claude and returns structured suggestions.
router.post('/analyze', async (req, res) => {
  const { note_text, current_rules, charge_codes } = req.body || {};

  if (!note_text || typeof note_text !== 'string') {
    return res.json({ suggestions: [], summary: '', error: 'No note text provided.' });
  }

  // Build a Python script that calls the OpenAI-compatible API
  const scriptPath = path.join(os.tmpdir(), `jtt-ai-analyze-${Date.now()}.py`);

  const currentSkip = JSON.stringify((current_rules?.skip_patterns || []).join(', ') || 'none');
  const currentMappings = JSON.stringify(
    (current_rules?.keyword_mappings || [])
      .map((m) => `${m.keyword} → ${m.key}`)
      .join(', ') || 'none'
  );

  const noteEscaped = JSON.stringify(note_text);

  const script = `
import os, json, sys
try:
    from openai import OpenAI
except ImportError:
    print(json.dumps({"suggestions": [], "summary": "", "error": "openai package not installed. Run: pip3 install openai"}))
    sys.exit(0)

client = OpenAI()

note = ${noteEscaped}
current_skip = ${currentSkip}
current_mappings = ${currentMappings}

system_prompt = """You are a parsing rules assistant for a Jira time-tracking tool.
You analyze a user's time log note and suggest parsing rules to improve accuracy.

You must return ONLY valid JSON in this exact format:
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

Rules for suggestions:
- Suggest skip_pattern for blocks that are clearly NOT work (lunch, breaks, personal notes, non-billable items with no Jira key)
- Suggest keyword_mapping ONLY when a block has no Jira key on its first line but has a recognizable keyword that could map to a Jira key visible elsewhere in the note
- Do NOT suggest mappings for blocks already marked with ??? (those are intentionally skipped)
- Do NOT suggest skip_pattern for blocks that already have a Jira key
- Keep patterns short and specific (e.g. "lunch" not "lunch in-house chicken")
- If no suggestions are needed, return an empty suggestions array
- Return at most 8 suggestions total"""

user_prompt = f"""Here is the user's time log note:

{note}

Current skip patterns already configured: {current_skip}
Current keyword mappings already configured: {current_mappings}

Analyze this note and suggest any additional parsing rules that would improve accuracy.
Only suggest rules that are NOT already configured."""

try:
    response = client.chat.completions.create(
        model="gemini-2.5-flash",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.1,
        max_tokens=1024,
    )
    content = response.choices[0].message.content.strip()
    # Extract JSON from response (handle markdown code blocks)
    import re
    json_match = re.search(r'\\{[\\s\\S]*\\}', content)
    if json_match:
        result = json.loads(json_match.group(0))
        print(json.dumps(result))
    else:
        print(json.dumps({"suggestions": [], "summary": "Could not parse AI response.", "error": None}))
except Exception as e:
    print(json.dumps({"suggestions": [], "summary": "", "error": str(e)}))
`;

  fs.writeFileSync(scriptPath, script, 'utf8');

  execFile('/usr/bin/python3', [scriptPath], { timeout: 30000 }, (err, stdout, stderr) => {
    fs.unlink(scriptPath, () => {});
    if (err && !stdout) {
      return res.json({ suggestions: [], summary: '', error: stderr || err.message });
    }
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return res.json(JSON.parse(jsonMatch[0]));
      }
    } catch { /* fall through */ }
    return res.json({ suggestions: [], summary: '', error: 'Could not parse AI response.' });
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
