import { useState } from 'react';
import { type WizardState, type CustomRule } from '../App';
import PageShell from '../components/PageShell';

interface Props {
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

// Case-insensitive Jira key: 1+ letters, dash, digits (e.g. fbai-875, mafg-4, cdz-12)
const JIRA_KEY_RE = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;

// "LABEL: key" — label is word chars, key is a Jira key (case-insensitive)
const LABEL_KEY_RE = /^([A-Za-z][A-Za-z0-9]*):\s*([A-Za-z][A-Za-z0-9]+-\d+)/i;

// Custom rule formats:
//   keyword -> JIRA-KEY [optional label]
//   keyword: JIRA-KEY [optional label]
const CUSTOM_RULE_RE = /^([^#>:\n]+?)\s*(?:->|:)\s*([A-Za-z][A-Za-z0-9]+-\d+)\s*(.*)?$/i;

function normalizeKey(key: string): string {
  return key.toUpperCase();
}

function inferLabel(key: string): string {
  return key.split('-')[0].toUpperCase();
}

function isSectionHeader(line: string): keyof ParsedCodes | null {
  const l = line.toLowerCase();

  // Must not contain a Jira key — if it does, it's a data line not a header
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
    if (detectedSection) {
      section = detectedSection;
      continue;
    }

    if (!section) continue;

    // Try "LABEL: key" format first
    const labelMatch = line.match(LABEL_KEY_RE);
    if (labelMatch) {
      result[section].push({
        label: labelMatch[1].toUpperCase(),
        key: normalizeKey(labelMatch[2]),
      });
      continue;
    }

    // Extract all Jira keys from the line
    const keys = [...line.matchAll(JIRA_KEY_RE)].map((m) => normalizeKey(m[1]));
    const isOldKeyLine = /\(old\s/i.test(line);
    const keysToAdd = isOldKeyLine ? keys.slice(0, 1) : keys;

    for (const key of keysToAdd) {
      result[section].push({ label: inferLabel(key), key });
    }
  }

  return result;
}

function parseCustomRules(text: string): CustomRule[] {
  const rules: CustomRule[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(CUSTOM_RULE_RE);
    if (m) {
      rules.push({
        keyword: m[1].trim().toLowerCase(),
        key: normalizeKey(m[2]),
        label: (m[3] || '').trim() || inferLabel(m[2]),
      });
    }
  }
  return rules;
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

export default function ChargeCodes({ update, onNext, onBack }: Props) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedCodes | null>(null);

  const [rawCustom, setRawCustom] = useState('');
  const [parsedCustom, setParsedCustom] = useState<CustomRule[] | null>(null);

  const handleParseAll = () => {
    const codes = parseCodesFromText(raw);
    const rules = rawCustom.trim() ? parseCustomRules(rawCustom) : [];
    setParsed(codes);
    setParsedCustom(rules);
    update({ chargeCodes: codes, customRules: rules });
  };

  const sectionLabels: { key: keyof ParsedCodes; label: string; color: string }[] = [
    { key: 'rapid_response', label: 'Rapid Response (RR)', color: '#f85149' },
    { key: 'standup', label: 'Standup', color: '#79c0ff' },
    { key: 'code_review', label: 'Code Review / Diff Review', color: '#e3b341' },
  ];

  const totalFound = parsed
    ? Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  const canContinue = parsed !== null;

  return (
    <PageShell
      badge="Step 5 of 9"
      title="Charge Codes"
      subtitle="Paste your team's standard charge codes below. The wizard will parse them and use them for best-effort matching when tasks aren't fully labeled."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!canContinue} onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div className="space-y-8">
        {/* ── Standard Charge Codes ── */}
        <div className="grid grid-cols-2 gap-6">
          {/* Left: paste area */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
              Paste your charge codes
            </label>
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

          {/* Right: parsed preview */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
              Parsed result{' '}
              {parsed && <span style={{ color: '#56d364' }}>— {totalFound} code{totalFound !== 1 ? 's' : ''} found</span>}
            </label>
            {parsed ? (
              <div className="space-y-4">
                {sectionLabels.map(({ key, label, color }) => (
                  <div key={key}>
                    <div className="text-xs font-semibold mb-2" style={{ color }}>
                      {label}
                    </div>
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

        {/* ── Custom Rules (optional) ── */}
        <div
          className="rounded-lg p-5"
          style={{ border: '1px solid #30363d', background: 'rgba(22,27,34,0.6)' }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold" style={{ color: '#e6edf3' }}>Custom Rules</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(37,99,235,0.15)', color: '#79c0ff', border: '1px solid rgba(37,99,235,0.3)' }}>
              optional
            </span>
          </div>
          <p className="text-xs mb-4 leading-relaxed" style={{ color: '#484f58' }}>
            Add your own keyword-to-ticket mappings. These are checked <strong style={{ color: '#8b949e' }}>before</strong> the
            default RR / code review rules, so they take priority. One rule per line.
            Lines starting with <code style={{ color: '#79c0ff' }}>#</code> are comments.
          </p>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
                Your custom rules
              </label>
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
                {parsedCustom && parsedCustom.length > 0 && (
                  <span style={{ color: '#56d364' }}>— {parsedCustom.length} rule{parsedCustom.length !== 1 ? 's' : ''}</span>
                )}
              </label>
              {parsedCustom && parsedCustom.length > 0 ? (
                <div className="space-y-1">
                  {parsedCustom.map((rule, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                      <span className="text-xs font-mono" style={{ color: '#e3b341', minWidth: 100 }}>{rule.keyword}</span>
                      <span className="text-xs" style={{ color: '#484f58' }}>→</span>
                      <span className="text-xs font-mono font-semibold" style={{ color: '#79c0ff' }}>{rule.key}</span>
                      {rule.label && rule.label !== rule.key.split('-')[0] && (
                        <span className="text-xs" style={{ color: '#8b949e' }}>{rule.label}</span>
                      )}
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
      </div>
    </PageShell>
  );
}
