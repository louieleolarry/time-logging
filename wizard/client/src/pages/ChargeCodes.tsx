import { useState } from 'react';
import { type WizardState, type CustomRule } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

interface CodeEntry { label: string; key: string; }

interface ParsedCodes {
  rapid_response: CodeEntry[];
  standup: CodeEntry[];
  code_review: CodeEntry[];
}

interface ParsedEntry {
  key: string;
  time: string;
  comment: string;
  minutes: number;
}

interface ParseResult {
  entries: ParsedEntry[];
  date: string | null;
  error?: string;
}

interface AISuggestion {
  type: 'skip_pattern' | 'keyword_mapping';
  value: string;
  key?: string;
  label?: string;
  reason: string;
}

interface AIAnalysisResult {
  suggestions: AISuggestion[];
  summary: string;
  error?: string;
}

// Case-insensitive Jira key: 1+ letters, dash, digits
const JIRA_KEY_RE = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;
const LABEL_KEY_RE = /^([A-Za-z][A-Za-z0-9]*):\s*([A-Za-z][A-Za-z0-9]+-\d+)/i;
const CUSTOM_RULE_RE = /^([^#>:\n]+?)\s*(?:->|:)\s*([A-Za-z][A-Za-z0-9]+-\d+)\s*(.*)?$/i;

function normalizeKey(key: string): string { return key.toUpperCase(); }
function inferLabel(key: string): string { return key.split('-')[0].toUpperCase(); }

function isSectionHeader(line: string): keyof ParsedCodes | null {
  const l = line.toLowerCase();
  if (JIRA_KEY_RE.test(line)) { JIRA_KEY_RE.lastIndex = 0; return null; }
  JIRA_KEY_RE.lastIndex = 0;
  if (/\brr\b/.test(l) || /rapid[\s-]?response/i.test(l)) return 'rapid_response';
  if (/standup/i.test(l) || /stand[\s-]?up/i.test(l) || /logged under/i.test(l)) return 'standup';
  if (/diff[\s-]?review/i.test(l) || /code[\s-]?review/i.test(l)) return 'code_review';
  return null;
}

function parseCodesFromText(text: string): ParsedCodes {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const result: ParsedCodes = { rapid_response: [], standup: [], code_review: [] };
  let section: keyof ParsedCodes | null = null;
  for (const line of lines) {
    const detectedSection = isSectionHeader(line);
    if (detectedSection) { section = detectedSection; continue; }
    if (!section) continue;
    const labelMatch = line.match(LABEL_KEY_RE);
    if (labelMatch) {
      result[section].push({ label: labelMatch[1].toUpperCase(), key: normalizeKey(labelMatch[2]) });
      continue;
    }
    const keys = [...line.matchAll(JIRA_KEY_RE)].map((m) => normalizeKey(m[1]));
    const isOldKeyLine = /\(old\s/i.test(line);
    const keysToAdd = isOldKeyLine ? keys.slice(0, 1) : keys;
    for (const key of keysToAdd) result[section].push({ label: inferLabel(key), key });
  }
  return result;
}

function parseCustomRules(text: string): CustomRule[] {
  const rules: CustomRule[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(CUSTOM_RULE_RE);
    if (m) rules.push({ keyword: m[1].trim().toLowerCase(), key: normalizeKey(m[2]), label: (m[3] || '').trim() || inferLabel(m[2]) });
  }
  return rules;
}

function formatMinutes(mins: number): string {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const EXAMPLE = `RR
fbai-875 / fceh-109
cdz-12 (old cdz-1) - documentation

code review / diff review
fbai-1667
fceh-751 / mdcr-13

STANDUP logged under
AI: FBAI-1683
AFG: mafg-4
FC: fceh-750`;

const CUSTOM_RULES_EXAMPLE = `# keyword -> JIRA-KEY  optional label
design -> PROJ-42  Design Work
oncall -> FCEH-200
infra work -> MDCR-99  Infrastructure`;

const OPEN_ENDED_OPTIONS = [
  { value: 'fill_day', label: 'Fill to daily target', desc: 'Open-ended blocks get whatever time remains to hit the target hours.' },
  { value: 'fixed_15m', label: 'Fixed 15 minutes', desc: 'Open-ended blocks always get exactly 15 minutes.' },
];

export default function ChargeCodes({ state, update, onNext, onBack }: Props) {
  const rules = state.parsingRules;

  // ── Charge codes state ──────────────────────────────────────────────────────
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedCodes | null>(null);
  const [rawCustom, setRawCustom] = useState('');
  const [parsedCustom, setParsedCustom] = useState<CustomRule[] | null>(null);

  // ── Sample note state ───────────────────────────────────────────────────────
  const [sampleNote, setSampleNote] = useState('');
  const [sampleResult, setSampleResult] = useState<ParseResult | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  // ── Parsing rules state ─────────────────────────────────────────────────────
  const [skipInput, setSkipInput] = useState('');
  const [kwKeyword, setKwKeyword] = useState('');
  const [kwJiraKey, setKwJiraKey] = useState('');
  const [kwLabel, setKwLabel] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<number>>(new Set());

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const setParsingRules = (patch: Partial<WizardState['parsingRules']>) => {
    update({ parsingRules: { ...rules, ...patch } });
  };

  const handleParseAll = () => {
    const codes = parseCodesFromText(raw);
    const customRules = rawCustom.trim() ? parseCustomRules(rawCustom) : [];
    setParsed(codes);
    setParsedCustom(customRules);
    update({ chargeCodes: codes, customRules });
  };

  // ── Sample note preview ─────────────────────────────────────────────────────
  const handleSamplePreview = async () => {
    if (!sampleNote.trim()) return;
    setSampleLoading(true);
    setSampleResult(null);
    try {
      const resp = await fetch('/api/parse-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleNote }),
      });
      setSampleResult(await resp.json());
    } catch {
      setSampleResult({ entries: [], date: null, error: 'Failed to connect to server.' });
    } finally {
      setSampleLoading(false);
    }
  };

  // ── Skip patterns ───────────────────────────────────────────────────────────
  const addSkipPattern = () => {
    const val = skipInput.trim().toLowerCase();
    if (!val || rules.skipPatterns.includes(val)) return;
    setParsingRules({ skipPatterns: [...rules.skipPatterns, val] });
    setSkipInput('');
  };
  const removeSkipPattern = (p: string) => setParsingRules({ skipPatterns: rules.skipPatterns.filter((x) => x !== p) });

  // ── Keyword mappings ────────────────────────────────────────────────────────
  const addKeywordMapping = () => {
    const kw = kwKeyword.trim().toLowerCase();
    const key = kwJiraKey.trim().toUpperCase();
    if (!kw || !key) return;
    const existing = rules.keywordMappings.filter((m) => m.keyword !== kw);
    setParsingRules({ keywordMappings: [...existing, { keyword: kw, key, label: kwLabel.trim() || key.split('-')[0] }] });
    setKwKeyword(''); setKwJiraKey(''); setKwLabel('');
  };
  const removeKeywordMapping = (kw: string) => setParsingRules({ keywordMappings: rules.keywordMappings.filter((m) => m.keyword !== kw) });

  // ── AI analysis ─────────────────────────────────────────────────────────────
  const applyAllSuggestions = (suggestions: AISuggestion[]) => {
    let newSkip = [...rules.skipPatterns];
    let newMappings = [...rules.keywordMappings];
    for (const s of suggestions) {
      if (s.type === 'skip_pattern') {
        const val = s.value.toLowerCase();
        if (!newSkip.includes(val)) newSkip = [...newSkip, val];
      } else if (s.type === 'keyword_mapping' && s.key) {
        const kw = s.value.toLowerCase();
        newMappings = newMappings.filter((m) => m.keyword !== kw);
        newMappings = [...newMappings, { keyword: kw, key: s.key.toUpperCase(), label: s.label || s.key.split('-')[0] }];
      }
    }
    setParsingRules({ skipPatterns: newSkip, keywordMappings: newMappings });
  };

  const runAIAnalysis = async () => {
    if (!sampleNote.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    setAppliedSuggestions(new Set());
    try {
      const resp = await fetch('/api/parsing-rules/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_text: sampleNote, current_rules: { skip_patterns: rules.skipPatterns, keyword_mappings: rules.keywordMappings }, charge_codes: state.chargeCodes }),
      });
      const data = await resp.json();
      setAiResult(data);
      if (data.suggestions?.length > 0) {
        applyAllSuggestions(data.suggestions);
        setAppliedSuggestions(new Set(data.suggestions.map((_: AISuggestion, i: number) => i)));
      }
    } catch {
      setAiResult({ suggestions: [], summary: '', error: 'Failed to connect to AI service.' });
    } finally {
      setAiLoading(false);
    }
  };

  const undoSuggestion = (idx: number, s: AISuggestion) => {
    if (s.type === 'skip_pattern') setParsingRules({ skipPatterns: rules.skipPatterns.filter((p) => p !== s.value.toLowerCase()) });
    else if (s.type === 'keyword_mapping') setParsingRules({ keywordMappings: rules.keywordMappings.filter((m) => m.keyword !== s.value.toLowerCase()) });
    setAppliedSuggestions((prev) => { const n = new Set(prev); n.delete(idx); return n; });
  };

  const sectionLabels: { key: keyof ParsedCodes; label: string; color: string }[] = [
    { key: 'rapid_response', label: 'Rapid Response (RR)', color: '#f85149' },
    { key: 'standup', label: 'Standup', color: '#79c0ff' },
    { key: 'code_review', label: 'Code Review / Diff Review', color: '#e3b341' },
  ];

  const totalFound = parsed ? Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0) : 0;
  const totalSampleMinutes = sampleResult?.entries?.reduce((sum, e) => sum + (e.minutes || 0), 0) ?? 0;
  const canContinue = parsed !== null;

  return (
    <PageShell
      badge="Step 5 of 7"
      title="Charge Codes"
      subtitle="Configure how your notes are parsed and mapped to Jira. Set up charge codes, custom rules, sample note preview, and parsing behavior."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!canContinue} onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div className="space-y-10">

        {/* ── Section 1: Standard Charge Codes ── */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: '#484f58' }}>Charge Codes</div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Paste your charge codes</label>
              <textarea
                className="wizard-input font-mono text-xs"
                rows={14}
                placeholder={EXAMPLE}
                value={raw}
                onChange={(e) => { setRaw(e.target.value); setParsed(null); }}
                style={{ resize: 'vertical', fontFamily: 'JetBrains Mono, monospace' }}
              />
              <div className="flex items-center gap-3 mt-3">
                <button className="btn-primary text-xs py-2 px-4" onClick={handleParseAll} disabled={!raw.trim()}>
                  Parse All &amp; Continue
                </button>
                <button
                  className="text-xs"
                  style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => { setRaw(EXAMPLE); setParsed(null); }}
                >
                  Load example
                </button>
              </div>
              <p className="text-xs mt-3 leading-relaxed" style={{ color: '#484f58' }}>
                Supported: <code style={{ color: '#79c0ff' }}>LABEL: key</code>,{' '}
                <code style={{ color: '#79c0ff' }}>key / key</code>, bare keys.
                Keys are case-insensitive. Section headers: RR, Standup, Code Review, Diff Review.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
                Parsed result{' '}
                {parsed && <span style={{ color: '#56d364' }}>— {totalFound} code{totalFound !== 1 ? 's' : ''} found</span>}
              </label>
              {parsed ? (
                <div className="space-y-4">
                  {sectionLabels.map(({ key, label, color }) => (
                    <div key={key}>
                      <div className="text-xs font-semibold mb-2" style={{ color }}>{label}</div>
                      {parsed[key].length === 0 ? (
                        <div className="text-xs" style={{ color: '#484f58' }}>No codes found</div>
                      ) : (
                        <div className="space-y-1">
                          {parsed[key].map((entry, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                              <span className="text-xs font-mono font-semibold" style={{ color: '#79c0ff', minWidth: 90 }}>{entry.key}</span>
                              <span className="text-xs" style={{ color: '#8b949e' }}>{entry.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 rounded-lg" style={{ border: '1px dashed #30363d' }}>
                  <span className="text-2xl mb-2">⌨</span>
                  <span className="text-xs" style={{ color: '#484f58' }}>Paste your codes and click Parse</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 2: Custom Rules ── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: 'rgba(22,27,34,0.6)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>Custom Rules</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>optional</span>
          </div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            Add your own keyword-to-ticket mappings. These are checked <strong style={{ color: '#8b949e' }}>before</strong> the
            default RR / code review rules, so they take priority. One rule per line.
            Lines starting with <code style={{ color: '#79c0ff' }}>#</code> are comments.
          </p>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Your custom rules</label>
              <textarea
                className="wizard-input font-mono text-xs"
                rows={8}
                placeholder={CUSTOM_RULES_EXAMPLE}
                value={rawCustom}
                onChange={(e) => { setRawCustom(e.target.value); setParsedCustom(null); }}
                style={{ resize: 'vertical', fontFamily: 'JetBrains Mono, monospace' }}
              />
              <p className="text-xs mt-2 leading-relaxed" style={{ color: '#484f58' }}>
                Format: <code style={{ color: '#79c0ff' }}>keyword -&gt; JIRA-KEY</code> or{' '}
                <code style={{ color: '#79c0ff' }}>keyword: JIRA-KEY</code>
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
                Parsed rules{' '}
                {parsedCustom && parsedCustom.length > 0 && <span style={{ color: '#56d364' }}>— {parsedCustom.length} rule{parsedCustom.length !== 1 ? 's' : ''}</span>}
              </label>
              {parsedCustom && parsedCustom.length > 0 ? (
                <div className="space-y-1">
                  {parsedCustom.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                      <span className="text-xs font-mono" style={{ color: '#e3b341', minWidth: 100 }}>{rule.keyword}</span>
                      <span className="text-xs" style={{ color: '#484f58' }}>→</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: '#79c0ff' }}>{rule.key}</span>
                      {rule.label && rule.label !== rule.key.split('-')[0] && <span className="text-xs" style={{ color: '#8b949e' }}>{rule.label}</span>}
                    </div>
                  ))}
                </div>
              ) : parsedCustom && parsedCustom.length === 0 ? (
                <div className="text-xs" style={{ color: '#484f58' }}>No valid rules found — check your format.</div>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 rounded-lg" style={{ border: '1px dashed #30363d' }}>
                  <span className="text-xs" style={{ color: '#484f58' }}>Rules will appear here after parsing</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 3: Sample Note ── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: 'rgba(22,27,34,0.6)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>Sample Note Preview</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>optional</span>
          </div>
          <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
            Paste <strong style={{ color: '#8b949e' }}>one full day's worth of time entries</strong> — exactly as they appear in your sticky note or notes app — to preview what would be logged to Jira.
          </p>
          <div className="rounded-md px-3 py-2 mb-4 text-xs leading-relaxed" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#79c0ff' }}>
            <strong>Include the date header</strong> — e.g. <code style={{ color: '#e6edf3' }}>Monday, May 5, 2026</code> — followed by <code style={{ color: '#e6edf3' }}>---</code> then your time blocks.
          </div>
          <textarea
            className="wizard-input font-mono text-xs w-full mb-3"
            rows={10}
            placeholder={"Monday, May 5, 2026\n\n---\n\nfbai-1683\nHyperion standup\n10:00-->10:30\n\nfceh-109\nRR - some ticket description\n10:45-->11:45\n\nfbai-875\nRR - open-ended task\n4:30-->"}
            value={sampleNote}
            onChange={(e) => { setSampleNote(e.target.value); setSampleResult(null); }}
            style={{ resize: 'vertical', fontFamily: 'JetBrains Mono, monospace' }}
          />
          <div className="flex gap-2 mb-4">
            <button
              onClick={handleSamplePreview}
              disabled={!sampleNote.trim() || sampleLoading}
              className="btn-primary text-xs py-2 px-4"
              style={{ opacity: !sampleNote.trim() || sampleLoading ? 0.5 : 1 }}
            >
              {sampleLoading ? 'Parsing…' : '🔍 Preview Parse'}
            </button>
            <button
              onClick={() => { setSampleNote(''); setSampleResult(null); }}
              className="text-xs px-4 py-2 rounded-md"
              style={{ background: '#21262d', color: '#8b949e', cursor: 'pointer', border: 'none' }}
            >
              Clear
            </button>
          </div>
          {sampleResult && (
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: sampleResult.error ? '#f85149' : '#30363d', background: '#161b22' }}>
              {sampleResult.error ? (
                <p className="text-xs p-4" style={{ color: '#f85149' }}>{sampleResult.error}</p>
              ) : sampleResult.entries.length === 0 ? (
                <div className="p-4">
                  <p className="text-xs" style={{ color: '#f0883e' }}>⚠️ No parseable time entries found.</p>
                  <p className="text-xs mt-1" style={{ color: '#484f58' }}>Make sure each block has a Jira key on the first line and a time range (e.g. <code>10:00--&gt;11:30</code>) on the last line.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#21262d', background: '#0d1117' }}>
                    <span className="text-xs font-semibold" style={{ color: '#8b949e' }}>
                      {sampleResult.entries.length} {sampleResult.entries.length === 1 ? 'entry' : 'entries'} would be logged
                      {sampleResult.date && <><span style={{ color: '#484f58' }}> · </span><span style={{ color: '#58a6ff' }}>📅 {sampleResult.date}</span></>}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: '#56d364' }}>Total: {formatMinutes(totalSampleMinutes)}</span>
                  </div>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#0d1117' }}>
                        <th className="text-left px-4 py-2" style={{ color: '#484f58', fontWeight: 600, width: 110 }}>Issue Key</th>
                        <th className="text-left px-4 py-2" style={{ color: '#484f58', fontWeight: 600 }}>Description</th>
                        <th className="text-right px-4 py-2" style={{ color: '#484f58', fontWeight: 600, width: 80 }}>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleResult.entries.map((e, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                          <td className="px-4 py-2 font-mono" style={{ color: '#58a6ff' }}>{e.key.toUpperCase()}</td>
                          <td className="px-4 py-2" style={{ color: '#e6edf3' }}>{e.comment}</td>
                          <td className="px-4 py-2 text-right font-mono" style={{ color: '#56d364' }}>{formatMinutes(e.minutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #30363d', background: '#0d1117' }}>
                        <td className="px-4 py-2" colSpan={2} style={{ color: '#484f58', fontSize: 11 }}>✓ These entries will be posted to Jira (duplicates skipped automatically)</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: '#56d364' }}>{formatMinutes(totalSampleMinutes)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Section 4: Parsing Rules ── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: 'rgba(22,27,34,0.6)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>Parsing Rules</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>optional</span>
          </div>
          <p className="text-xs mb-5 leading-relaxed" style={{ color: '#484f58' }}>
            Control how blocks are parsed. Skip non-work entries, map keywords to Jira keys, and configure open-ended time behavior. Use Claude Code to auto-detect rules from your sample note above.
          </p>

          <div className="space-y-6">
            {/* Open-ended time */}
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Open-ended Time Ranges</div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
                When a block has a start time but no end time (e.g. <code style={{ color: '#79c0ff' }}>4:30--&gt;</code>), how should the duration be calculated?
              </p>
              <div className="flex gap-3 flex-wrap mb-3">
                {OPEN_ENDED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setParsingRules({ openEndedTimeBehavior: opt.value as 'fill_day' | 'fixed_15m' })}
                    className="flex-1 rounded-lg p-3 text-left transition-all"
                    style={{
                      border: `1px solid ${rules.openEndedTimeBehavior === opt.value ? '#2563eb' : '#30363d'}`,
                      background: rules.openEndedTimeBehavior === opt.value ? 'rgba(37,99,235,0.1)' : '#0d1117',
                      minWidth: 200,
                    }}
                  >
                    <div className="text-xs font-semibold mb-1" style={{ color: rules.openEndedTimeBehavior === opt.value ? '#79c0ff' : '#e6edf3' }}>{opt.label}</div>
                    <div className="text-xs leading-relaxed" style={{ color: '#484f58' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs" style={{ color: '#8b949e' }}>Target hours/day</label>
                <input
                  type="number" min="1" max="24" step="0.25"
                  value={rules.targetHoursPerDay}
                  onChange={(e) => setParsingRules({ targetHoursPerDay: parseFloat(e.target.value) || 8.25 })}
                  className="wizard-input"
                  style={{ width: 80 }}
                />
                <span className="text-xs" style={{ color: '#484f58' }}>hours (default 8.25)</span>
              </div>
            </div>

            {/* Skip patterns */}
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Skip Patterns</div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
                Any block containing one of these strings (case-insensitive) will be silently skipped. Good for <code style={{ color: '#79c0ff' }}>lunch</code>, <code style={{ color: '#79c0ff' }}>in-house</code>, or non-billable notes.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  className="wizard-input flex-1"
                  placeholder="e.g. lunch"
                  value={skipInput}
                  onChange={(e) => setSkipInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSkipPattern()}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                />
                <button className="btn-primary text-xs px-4" onClick={addSkipPattern} disabled={!skipInput.trim()}>Add</button>
              </div>
              {rules.skipPatterns.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {rules.skipPatterns.map((p) => (
                    <span key={p} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
                      style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}>
                      {p}
                      <button onClick={() => removeSkipPattern(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f85149', lineHeight: 1, padding: 0, fontSize: 14 }}>×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs" style={{ color: '#484f58' }}>No skip patterns yet. Add one above or use Claude Code analysis below.</div>
              )}
            </div>

            {/* Keyword mappings */}
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Keyword → Jira Key Mappings</div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
                When a block has no explicit Jira key on the first line, these mappings are checked first.
              </p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <input className="wizard-input" placeholder="keyword (e.g. oncall)" value={kwKeyword} onChange={(e) => setKwKeyword(e.target.value)}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                <input className="wizard-input" placeholder="Jira key (e.g. FCEH-200)" value={kwJiraKey} onChange={(e) => setKwJiraKey(e.target.value)}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
                <input className="wizard-input" placeholder="label (optional)" value={kwLabel} onChange={(e) => setKwLabel(e.target.value)}
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }} />
              </div>
              <button className="btn-primary text-xs px-4 py-2 mb-3" onClick={addKeywordMapping} disabled={!kwKeyword.trim() || !kwJiraKey.trim()}>Add Mapping</button>
              {rules.keywordMappings.length > 0 ? (
                <div className="space-y-1">
                  {rules.keywordMappings.map((m) => (
                    <div key={m.keyword} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                      <span className="text-xs font-mono" style={{ color: '#e3b341', minWidth: 120 }}>{m.keyword}</span>
                      <span className="text-xs" style={{ color: '#484f58' }}>→</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: '#79c0ff' }}>{m.key}</span>
                      {m.label && m.label !== m.key.split('-')[0] && <span className="text-xs" style={{ color: '#8b949e' }}>{m.label}</span>}
                      <button onClick={() => removeKeywordMapping(m.keyword)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#484f58', fontSize: 14 }}>×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs" style={{ color: '#484f58' }}>No keyword mappings yet.</div>
              )}
            </div>

            {/* AI analysis */}
            <div className="rounded-lg p-4" style={{ border: '1px solid rgba(37,99,235,0.3)', background: 'rgba(37,99,235,0.05)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold" style={{ color: '#79c0ff' }}>✦ Claude Code Analysis</span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>uses your local Claude Code session</span>
              </div>
              <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
                Paste your sample note above, then click <strong style={{ color: '#8b949e' }}>Analyze with Claude Code</strong> to auto-detect skip patterns and keyword mappings. Suggestions are applied immediately — you can undo each one.
              </p>
              <button
                onClick={runAIAnalysis}
                disabled={!sampleNote.trim() || aiLoading}
                className="btn-primary text-xs py-2 px-4 mb-4"
                style={{ opacity: !sampleNote.trim() || aiLoading ? 0.5 : 1 }}
              >
                {aiLoading ? '⏳ Analyzing…' : '✦ Analyze with Claude Code'}
              </button>
              {aiResult && (
                <div>
                  {aiResult.error ? (
                    <p className="text-xs" style={{ color: '#f85149' }}>{aiResult.error}</p>
                  ) : (
                    <>
                      {aiResult.summary && <p className="text-xs mb-3 leading-relaxed" style={{ color: '#8b949e' }}>{aiResult.summary}</p>}
                      {aiResult.suggestions.length === 0 ? (
                        <p className="text-xs" style={{ color: '#484f58' }}>No additional rules suggested — your note looks well-structured.</p>
                      ) : (
                        <div className="space-y-2">
                          {aiResult.suggestions.map((s, i) => (
                            <div key={i} className="flex items-start gap-3 px-3 py-2 rounded" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                              <span className="text-xs px-2 py-0.5 rounded font-mono" style={{
                                background: s.type === 'skip_pattern' ? 'rgba(248,81,73,0.1)' : 'rgba(37,99,235,0.1)',
                                color: s.type === 'skip_pattern' ? '#f85149' : '#79c0ff',
                                border: `1px solid ${s.type === 'skip_pattern' ? 'rgba(248,81,73,0.3)' : 'rgba(37,99,235,0.3)'}`,
                                whiteSpace: 'nowrap',
                              }}>
                                {s.type === 'skip_pattern' ? 'skip' : 'map'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-mono font-semibold" style={{ color: '#e6edf3' }}>
                                  {s.value}{s.key ? ` → ${s.key}` : ''}
                                </div>
                                <div className="text-xs mt-0.5" style={{ color: '#484f58' }}>{s.reason}</div>
                              </div>
                              {appliedSuggestions.has(i) && (
                                <button onClick={() => undoSuggestion(i, s)} className="text-xs px-2 py-1 rounded"
                                  style={{ background: '#21262d', color: '#8b949e', border: '1px solid #30363d', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                  Undo
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </PageShell>
  );
}
