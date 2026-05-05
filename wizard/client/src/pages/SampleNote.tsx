import { useState } from 'react';

interface SampleNoteProps {
  onNext: () => void;
  onBack: () => void;
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

function formatMinutes(mins: number): string {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function SampleNote({ onNext, onBack }: SampleNoteProps) {
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePreview = async () => {
    if (!note.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch('/api/parse-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note }),
      });
      const data = await resp.json();
      setResult(data);
    } catch {
      setResult({ entries: [], date: null, error: 'Failed to connect to server.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!note.trim()) { onNext(); return; }
    try {
      await fetch('/api/config/sample-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_note: note }),
      });
    } catch { /* non-blocking */ }
    onNext();
  };

  const totalMinutes = result?.entries?.reduce((sum, e) => sum + (e.minutes || 0), 0) ?? 0;

  return (
    <div className="px-10 py-8 max-w-2xl">
      <div className="mb-2 text-xs font-semibold tracking-widest uppercase" style={{ color: '#8b949e' }}>
        STEP 9 OF 10
      </div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: '#e6edf3' }}>Sample Note</h1>
      <p className="text-sm mb-2" style={{ color: '#8b949e' }}>
        Paste <strong style={{ color: '#e6edf3' }}>one full day's worth of time entries</strong> below — exactly as they appear in your sticky note or notes app. We'll parse it and show you exactly what would be logged to Jira.
      </p>
      <div className="rounded-md px-4 py-3 mb-5 text-xs leading-relaxed" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', color: '#79c0ff' }}>
        <strong>Your note must start with the date header</strong> — e.g.{' '}
        <code style={{ color: '#e6edf3' }}>Monday, May 5, 2026</code> — followed by a{' '}
        <code style={{ color: '#e6edf3' }}>---</code> separator, then your time blocks.
        Without the date, the parser cannot determine which day to log.
      </div>

      <textarea
        className="w-full rounded-lg border text-sm font-mono p-3 mb-4 resize-y"
        style={{
          background: '#161b22',
          borderColor: '#30363d',
          color: '#e6edf3',
          minHeight: 240,
          outline: 'none',
          lineHeight: '1.6',
        }}
        placeholder={
          "Monday, May 5, 2026\n\n---\n\nfbai-1683\nHyperion standup\n10:00-->10:30\n\nfceh-109\nRR - some ticket description\n10:45-->11:45\n\nfbai-875\nRR - another task\n1:00-->3:00\n\nfbai-875\nRR - open-ended task\n4:30-->"
        }
        value={note}
        onChange={(e) => { setNote(e.target.value); setResult(null); }}
      />

      <div className="flex gap-3 mb-6">
        <button
          onClick={handlePreview}
          disabled={!note.trim() || loading}
          className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: note.trim() && !loading ? '#2563eb' : '#21262d',
            color: note.trim() && !loading ? '#fff' : '#484f58',
            cursor: note.trim() && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? 'Parsing…' : '🔍 Preview Parse'}
        </button>
        <button
          onClick={() => { setNote(''); setResult(null); }}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{ background: '#21262d', color: '#8b949e', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {result && (
        <div
          className="rounded-lg border mb-6 overflow-hidden"
          style={{ borderColor: result.error ? '#f85149' : '#30363d', background: '#161b22' }}
        >
          {result.error ? (
            <p className="text-sm p-4" style={{ color: '#f85149' }}>{result.error}</p>
          ) : result.entries.length === 0 ? (
            <div className="p-4">
              <p className="text-sm" style={{ color: '#f0883e' }}>
                ⚠️ No parseable time entries found.
              </p>
              <p className="text-xs mt-1" style={{ color: '#484f58' }}>
                Make sure each block has a Jira key (e.g. <code>FBAI-875</code>) on the first line and a time range (e.g. <code>10:00--&gt;11:30</code>) on the last line. Blocks without a time range are skipped.
              </p>
            </div>
          ) : (
            <>
              {/* Header bar */}
              <div
                className="flex items-center justify-between px-4 py-2 border-b"
                style={{ borderColor: '#21262d', background: '#0d1117' }}
              >
                <span className="text-xs font-semibold" style={{ color: '#8b949e' }}>
                  {result.entries.length} {result.entries.length === 1 ? 'entry' : 'entries'} would be logged
                  {result.date && (
                    <span style={{ color: '#484f58' }}> · </span>
                  )}
                  {result.date && (
                    <span style={{ color: '#58a6ff' }}>📅 {result.date}</span>
                  )}
                </span>
                <span className="text-xs font-semibold" style={{ color: '#56d364' }}>
                  Total: {formatMinutes(totalMinutes)}
                </span>
              </div>

              {/* Table */}
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#0d1117' }}>
                    <th className="text-left px-4 py-2" style={{ color: '#484f58', fontWeight: 600, width: '110px' }}>Issue Key</th>
                    <th className="text-left px-4 py-2" style={{ color: '#484f58', fontWeight: 600 }}>Description</th>
                    <th className="text-right px-4 py-2" style={{ color: '#484f58', fontWeight: 600, width: '80px' }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((e, i) => (
                    <tr
                      key={i}
                      style={{ borderTop: '1px solid #21262d' }}
                    >
                      <td className="px-4 py-2 font-mono" style={{ color: '#58a6ff' }}>
                        {e.key.toUpperCase()}
                      </td>
                      <td className="px-4 py-2" style={{ color: '#e6edf3' }}>
                        {e.comment}
                      </td>
                      <td className="px-4 py-2 text-right font-mono" style={{ color: '#56d364' }}>
                        {formatMinutes(e.minutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #30363d', background: '#0d1117' }}>
                    <td className="px-4 py-2" colSpan={2} style={{ color: '#484f58', fontSize: '11px' }}>
                      ✓ These entries will be posted to Jira (duplicates skipped automatically)
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: '#56d364' }}>
                      {formatMinutes(totalMinutes)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-5 py-2 rounded-md text-sm font-medium"
          style={{ background: '#21262d', color: '#8b949e', cursor: 'pointer' }}
        >
          Back
        </button>
        <button
          onClick={handleSave}
          className="px-5 py-2 rounded-md text-sm font-medium"
          style={{ background: '#2563eb', color: '#fff', cursor: 'pointer' }}
        >
          {note.trim() && result && result.entries.length > 0 ? 'Looks Good — Continue' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
