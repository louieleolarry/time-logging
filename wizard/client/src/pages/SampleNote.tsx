import { useState } from 'react';

interface SampleNoteProps {
  onNext: () => void;
  onBack: () => void;
}

interface ParsedEntry {
  key: string;
  time: string;
  comment: string;
}

interface ParseResult {
  entries: ParsedEntry[];
  date: string | null;
  error?: string;
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
    // Save the sample note to config for reference
    try {
      await fetch('/api/config/sample-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample_note: note }),
      });
    } catch { /* non-blocking */ }
    onNext();
  };

  return (
    <div className="px-10 py-8 max-w-2xl">
      <div className="mb-2 text-xs font-semibold tracking-widest uppercase" style={{ color: '#8b949e' }}>
        STEP 7 OF 9
      </div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: '#e6edf3' }}>Sample Note</h1>
      <p className="text-sm mb-6" style={{ color: '#8b949e' }}>
        Paste a typical day's time entry note below. We'll parse it and show you exactly what would be logged to Jira — so you can verify the format looks right before your first automated run.
      </p>

      <textarea
        className="w-full rounded-lg border text-sm font-mono p-3 mb-4 resize-y"
        style={{
          background: '#161b22',
          borderColor: '#30363d',
          color: '#e6edf3',
          minHeight: 220,
          outline: 'none',
        }}
        placeholder={"fbai-1683\nHyperion standup\n10:00-->10:30\n\nfceh-109\nRR - some ticket description\n10:45-->11:45\n\nfbai-875\nRR - another task\n1:00-->3:00"}
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
        <div className="rounded-lg border p-4 mb-6" style={{ borderColor: result.error ? '#f85149' : '#30363d', background: '#161b22' }}>
          {result.error ? (
            <p className="text-sm" style={{ color: '#f85149' }}>{result.error}</p>
          ) : (
            <>
              {result.date && (
                <p className="text-xs mb-3" style={{ color: '#8b949e' }}>
                  📅 Date detected: <span style={{ color: '#e6edf3' }}>{result.date}</span>
                </p>
              )}
              {result.entries.length === 0 ? (
                <p className="text-sm" style={{ color: '#f0883e' }}>
                  ⚠️ No parseable time entries found. Check that your note has Jira keys (e.g. <code>FBAI-875</code>) and time ranges (e.g. <code>10:00--&gt;11:30</code>).
                </p>
              ) : (
                <>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
                    {result.entries.length} {result.entries.length === 1 ? 'entry' : 'entries'} would be logged:
                  </p>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#8b949e' }}>
                        <th className="text-left pb-2 pr-4">Issue Key</th>
                        <th className="text-left pb-2 pr-4">Time</th>
                        <th className="text-left pb-2">Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.entries.map((e, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                          <td className="py-1.5 pr-4 font-mono" style={{ color: '#58a6ff' }}>{e.key}</td>
                          <td className="py-1.5 pr-4" style={{ color: '#56d364' }}>{e.time}</td>
                          <td className="py-1.5" style={{ color: '#e6edf3' }}>{e.comment}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
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
          {note.trim() ? 'Looks Good — Continue' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
