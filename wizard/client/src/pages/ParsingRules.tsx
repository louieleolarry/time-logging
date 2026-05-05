import { useState } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

interface AISuggestion {
  type: 'skip_pattern' | 'keyword_mapping';
  value: string;           // for skip_pattern: the pattern string
  key?: string;            // for keyword_mapping: the Jira key
  label?: string;          // for keyword_mapping: optional label
  reason: string;          // why the AI is suggesting this
}

interface AIAnalysisResult {
  suggestions: AISuggestion[];
  summary: string;
  error?: string;
}

const OPEN_ENDED_OPTIONS = [
  { value: 'fill_day', label: 'Fill to daily target', desc: 'Open-ended blocks get whatever time remains to hit the target hours.' },
  { value: 'fixed_15m', label: 'Fixed 15 minutes', desc: 'Open-ended blocks always get exactly 15 minutes.' },
];

export default function ParsingRules({ state, update, onNext, onBack }: Props) {
  const rules = state.parsingRules;

  // Local editable state
  const [skipInput, setSkipInput] = useState('');
  const [kwKeyword, setKwKeyword] = useState('');
  const [kwJiraKey, setKwJiraKey] = useState('');
  const [kwLabel, setKwLabel] = useState('');

  // AI analysis
  const [sampleText, setSampleText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<number>>(new Set());

  const setRules = (patch: Partial<WizardState['parsingRules']>) => {
    update({ parsingRules: { ...rules, ...patch } });
  };

  // ── Skip patterns ──────────────────────────────────────────────────────────
  const addSkipPattern = () => {
    const val = skipInput.trim().toLowerCase();
    if (!val || rules.skipPatterns.includes(val)) return;
    setRules({ skipPatterns: [...rules.skipPatterns, val] });
    setSkipInput('');
  };

  const removeSkipPattern = (p: string) => {
    setRules({ skipPatterns: rules.skipPatterns.filter((x) => x !== p) });
  };

  // ── Keyword mappings ───────────────────────────────────────────────────────
  const addKeywordMapping = () => {
    const kw = kwKeyword.trim().toLowerCase();
    const key = kwJiraKey.trim().toUpperCase();
    if (!kw || !key) return;
    const existing = rules.keywordMappings.filter((m) => m.keyword !== kw);
    setRules({
      keywordMappings: [...existing, { keyword: kw, key, label: kwLabel.trim() || key.split('-')[0] }],
    });
    setKwKeyword('');
    setKwJiraKey('');
    setKwLabel('');
  };

  const removeKeywordMapping = (kw: string) => {
    setRules({ keywordMappings: rules.keywordMappings.filter((m) => m.keyword !== kw) });
  };

  // ── AI analysis ────────────────────────────────────────────────────────────
  const runAIAnalysis = async () => {
    if (!sampleText.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    setAppliedSuggestions(new Set());
    try {
      const resp = await fetch('/api/parsing-rules/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note_text: sampleText,
          current_rules: {
            skip_patterns: rules.skipPatterns,
            keyword_mappings: rules.keywordMappings,
          },
          charge_codes: state.chargeCodes,
        }),
      });
      const data = await resp.json();
      setAiResult(data);
      // Auto-apply all suggestions immediately
      if (data.suggestions && data.suggestions.length > 0) {
        applyAllSuggestions(data.suggestions);
        setAppliedSuggestions(new Set(data.suggestions.map((_: AISuggestion, i: number) => i)));
      }
    } catch {
      setAiResult({ suggestions: [], summary: '', error: 'Failed to connect to AI service.' });
    } finally {
      setAiLoading(false);
    }
  };

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

    setRules({ skipPatterns: newSkip, keywordMappings: newMappings });
  };

  const undoSuggestion = (idx: number, s: AISuggestion) => {
    if (s.type === 'skip_pattern') {
      setRules({ skipPatterns: rules.skipPatterns.filter((p) => p !== s.value.toLowerCase()) });
    } else if (s.type === 'keyword_mapping') {
      setRules({ keywordMappings: rules.keywordMappings.filter((m) => m.keyword !== s.value.toLowerCase()) });
    }
    setAppliedSuggestions((prev) => { const n = new Set(prev); n.delete(idx); return n; });
  };

  return (
    <PageShell
      badge="Step 6 of 10"
      title="Parsing Rules"
      subtitle="Control how your notes are parsed. Skip non-work blocks, map keywords to Jira keys, and configure how open-ended time entries are handled. Use AI to auto-detect rules from a sample note."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div className="space-y-8" style={{ maxWidth: 700 }}>

        {/* ── Open-ended time behavior ─────────────────────────────────────── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: '#161b22' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Open-ended Time Ranges</div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            When a block has a start time but no end time (e.g. <code style={{ color: '#79c0ff' }}>4:30--&gt;</code>),
            how should the duration be calculated?
          </p>
          <div className="flex gap-3 flex-wrap">
            {OPEN_ENDED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRules({ openEndedTimeBehavior: opt.value as 'fill_day' | 'fixed_15m' })}
                className="flex-1 rounded-lg p-3 text-left transition-all"
                style={{
                  border: `1px solid ${rules.openEndedTimeBehavior === opt.value ? '#2563eb' : '#30363d'}`,
                  background: rules.openEndedTimeBehavior === opt.value ? 'rgba(37,99,235,0.1)' : '#0d1117',
                  minWidth: 200,
                }}
              >
                <div className="text-xs font-semibold mb-1" style={{ color: rules.openEndedTimeBehavior === opt.value ? '#79c0ff' : '#e6edf3' }}>
                  {opt.label}
                </div>
                <div className="text-xs leading-relaxed" style={{ color: '#484f58' }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="text-xs" style={{ color: '#8b949e' }}>Target hours/day</label>
            <input
              type="number"
              min="1"
              max="24"
              step="0.25"
              value={rules.targetHoursPerDay}
              onChange={(e) => setRules({ targetHoursPerDay: parseFloat(e.target.value) || 8.25 })}
              className="wizard-input"
              style={{ width: 80 }}
            />
            <span className="text-xs" style={{ color: '#484f58' }}>hours (default 8.25)</span>
          </div>
        </div>

        {/* ── Skip patterns ────────────────────────────────────────────────── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: '#161b22' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Skip Patterns</div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            Any block whose text contains one of these strings (case-insensitive) will be skipped entirely —
            no time logged, no Jira entry. Good for <code style={{ color: '#79c0ff' }}>lunch</code>,{' '}
            <code style={{ color: '#79c0ff' }}>in-house</code>, or non-billable notes.
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
            <button
              className="btn-primary text-xs px-4"
              onClick={addSkipPattern}
              disabled={!skipInput.trim()}
            >
              Add
            </button>
          </div>
          {rules.skipPatterns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {rules.skipPatterns.map((p) => (
                <span
                  key={p}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
                  style={{ background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149' }}
                >
                  {p}
                  <button
                    onClick={() => removeSkipPattern(p)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f85149', lineHeight: 1, padding: 0, fontSize: 14 }}
                  >×</button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs" style={{ color: '#484f58' }}>No skip patterns yet. Add one above or use AI analysis below.</div>
          )}
        </div>

        {/* ── Keyword mappings ─────────────────────────────────────────────── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: '#161b22' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Keyword → Jira Key Mappings</div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            When a block has no explicit Jira key on the first line, these mappings are checked first.
            If the block text contains the keyword, it's attributed to the mapped Jira key.
          </p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <input
              className="wizard-input"
              placeholder="keyword (e.g. oncall)"
              value={kwKeyword}
              onChange={(e) => setKwKeyword(e.target.value)}
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            />
            <input
              className="wizard-input"
              placeholder="Jira key (e.g. FCEH-200)"
              value={kwJiraKey}
              onChange={(e) => setKwJiraKey(e.target.value.toUpperCase())}
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            />
            <div className="flex gap-2">
              <input
                className="wizard-input flex-1"
                placeholder="label (optional)"
                value={kwLabel}
                onChange={(e) => setKwLabel(e.target.value)}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
              <button
                className="btn-primary text-xs px-4 flex-shrink-0"
                onClick={addKeywordMapping}
                disabled={!kwKeyword.trim() || !kwJiraKey.trim()}
              >
                Add
              </button>
            </div>
          </div>
          {rules.keywordMappings.length > 0 ? (
            <div className="space-y-1">
              {rules.keywordMappings.map((m) => (
                <div key={m.keyword} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#0d1117', border: '1px solid #30363d' }}>
                  <span className="text-xs font-mono" style={{ color: '#e3b341', minWidth: 120 }}>{m.keyword}</span>
                  <span className="text-xs" style={{ color: '#484f58' }}>→</span>
                  <span className="text-xs font-mono font-semibold" style={{ color: '#79c0ff', minWidth: 90 }}>{m.key}</span>
                  {m.label && <span className="text-xs" style={{ color: '#8b949e' }}>{m.label}</span>}
                  <button
                    onClick={() => removeKeywordMapping(m.keyword)}
                    className="ml-auto text-xs"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}
                  >Remove</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs" style={{ color: '#484f58' }}>No keyword mappings yet.</div>
          )}
        </div>

        {/* ── AI Analysis ──────────────────────────────────────────────────── */}
        <div className="rounded-lg p-5" style={{ border: '1px solid #30363d', background: 'rgba(22,27,34,0.6)' }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>AI Rule Analysis</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>
              Claude
            </span>
          </div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            Paste <strong style={{ color: '#8b949e' }}>one full day's note</strong> — starting with the date header (e.g.{' '}
            <code style={{ color: '#79c0ff' }}>Monday, May 5, 2026</code>) and the{' '}
            <code style={{ color: '#79c0ff' }}>---</code> separator, then all your time blocks for that day.
            Claude will analyze it and auto-apply suggested skip patterns and keyword mappings — you can undo any suggestion individually.
          </p>

          <textarea
            className="w-full rounded-lg border text-xs font-mono p-3 mb-3"
            rows={10}
            style={{
              background: '#0d1117',
              borderColor: '#30363d',
              color: '#e6edf3',
              resize: 'vertical',
              outline: 'none',
              lineHeight: '1.6',
              fontFamily: 'JetBrains Mono, monospace',
            }}
            placeholder={"Monday, May 5, 2026\n\n---\n\nfbai-1683\nHyperion standup\n10:00-->10:30\n\nfceh-109\nRR - some ticket description\n10:45-->11:45\n\nlunch\nin-house chkn\n12:30-->1:00\n\nfbai-875\nRR - some task\n1:00-->3:00\n\nfbai-875\nRR - open-ended task\n4:30-->"}
            value={sampleText}
            onChange={(e) => { setSampleText(e.target.value); setAiResult(null); }}
          />

          <button
            className="btn-primary text-xs px-5 py-2"
            onClick={runAIAnalysis}
            disabled={!sampleText.trim() || aiLoading}
          >
            {aiLoading ? '✦ Analyzing…' : '✦ Analyze with AI'}
          </button>

          {aiResult && (
            <div className="mt-4 rounded-lg overflow-hidden" style={{ border: `1px solid ${aiResult.error ? '#f85149' : '#30363d'}` }}>
              {aiResult.error ? (
                <p className="text-xs p-4" style={{ color: '#f85149' }}>{aiResult.error}</p>
              ) : (
                <>
                  {aiResult.summary && (
                    <div className="px-4 py-3 border-b text-xs leading-relaxed" style={{ borderColor: '#21262d', color: '#8b949e', background: '#0d1117' }}>
                      {aiResult.summary}
                    </div>
                  )}
                  {aiResult.suggestions.length === 0 ? (
                    <div className="px-4 py-3 text-xs" style={{ color: '#56d364' }}>
                      ✓ No additional rules needed — your current setup looks good for this note.
                    </div>
                  ) : (
                    <div className="divide-y" style={{ borderColor: '#21262d' }}>
                      {aiResult.suggestions.map((s, i) => (
                        <div key={i} className="flex items-start gap-3 px-4 py-3" style={{ background: appliedSuggestions.has(i) ? 'rgba(86,211,100,0.05)' : 'transparent' }}>
                          <span
                            className="text-xs px-2 py-0.5 rounded flex-shrink-0 mt-0.5"
                            style={{
                              background: s.type === 'skip_pattern' ? 'rgba(248,81,73,0.1)' : 'rgba(227,179,65,0.1)',
                              border: `1px solid ${s.type === 'skip_pattern' ? 'rgba(248,81,73,0.3)' : 'rgba(227,179,65,0.3)'}`,
                              color: s.type === 'skip_pattern' ? '#f85149' : '#e3b341',
                            }}
                          >
                            {s.type === 'skip_pattern' ? 'skip' : 'map'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-mono font-semibold mb-0.5" style={{ color: '#e6edf3' }}>
                              {s.type === 'skip_pattern' ? `"${s.value}"` : `"${s.value}" → ${s.key}`}
                              {s.label && s.type === 'keyword_mapping' && <span style={{ color: '#8b949e' }}> ({s.label})</span>}
                            </div>
                            <div className="text-xs" style={{ color: '#484f58' }}>{s.reason}</div>
                          </div>
                          {appliedSuggestions.has(i) ? (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs" style={{ color: '#56d364' }}>✓ Applied</span>
                              <button
                                onClick={() => undoSuggestion(i, s)}
                                className="text-xs"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}
                              >Undo</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                applyAllSuggestions([s]);
                                setAppliedSuggestions((prev) => new Set([...prev, i]));
                              }}
                              className="text-xs px-3 py-1 rounded flex-shrink-0"
                              style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', cursor: 'pointer' }}
                            >Apply</button>
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
    </PageShell>
  );
}
