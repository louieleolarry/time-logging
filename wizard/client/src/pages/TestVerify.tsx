import { useState, useRef, useEffect } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

interface RunEvent {
  type: 'start' | 'stdout' | 'stderr' | 'done' | 'error';
  text?: string;
  label?: string;
  message?: string;
  code?: number;
}

function RunButton({ label, mode, date }: { label: string; mode: string; date?: string }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<RunEvent[]>([]);
  const [finished, setFinished] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const run = async () => {
    setRunning(true);
    setFinished(false);
    setLines([]);

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, date }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const match = chunk.match(/^data:\s*(.+)$/m);
          if (match) {
            try {
              const event: RunEvent = JSON.parse(match[1]);
              setLines((prev) => [...prev, event]);
              if (event.type === 'done' || event.type === 'error') {
                setFinished(true);
                setRunning(false);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (err: unknown) {
      setLines((prev) => [...prev, { type: 'error', message: err instanceof Error ? err.message : 'Connection error' }]);
      setFinished(true);
      setRunning(false);
    }
  };

  const exitCode = lines.find((l) => l.type === 'done')?.code;
  const success = finished && exitCode === 0;
  const failed = finished && exitCode !== undefined && exitCode !== 0;

  return (
    <div className="mb-4">
      <button
        className="btn-primary text-sm px-4 py-2"
        onClick={run}
        disabled={running}
        style={{
          background: running ? '#1d4ed8' : success ? '#16a34a' : '#2563eb',
          cursor: running ? 'wait' : 'pointer',
          opacity: running ? 0.8 : 1,
        }}
      >
        {running ? (
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Running...
          </span>
        ) : success ? (
          `✓ ${label}`
        ) : (
          `▶ ${label}`
        )}
      </button>

      {lines.length > 0 && (
        <div
          ref={outputRef}
          className="mt-3 rounded-lg overflow-y-auto"
          style={{
            background: '#010409',
            border: `1px solid ${failed ? 'rgba(248,81,73,0.3)' : success ? 'rgba(22,163,74,0.3)' : '#30363d'}`,
            maxHeight: 280,
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          <pre className="text-xs p-4 m-0 whitespace-pre-wrap">
            {lines.map((line, i) => {
              if (line.type === 'start') return <div key={i} style={{ color: '#79c0ff' }}>$ {line.label}</div>;
              if (line.type === 'stdout') return <div key={i} style={{ color: '#7ee787' }}>{line.text}</div>;
              if (line.type === 'stderr') return <div key={i} style={{ color: '#e3b341' }}>{line.text}</div>;
              if (line.type === 'done') return <div key={i} style={{ color: line.code === 0 ? '#56d364' : '#f85149', marginTop: 8 }}>{line.code === 0 ? '✓' : '✗'} {line.message}</div>;
              if (line.type === 'error') return <div key={i} style={{ color: '#f85149' }}>Error: {line.message}</div>;
              return null;
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

function DateRunButton() {
  const [dateValue, setDateValue] = useState('');
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <input
          type="date"
          value={dateValue}
          onChange={(e) => setDateValue(e.target.value)}
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: '#161b22', border: '1px solid #30363d', color: '#e6edf3', fontFamily: 'JetBrains Mono, monospace' }}
        />
      </div>
      {dateValue && <RunButton label={`Run for ${dateValue}`} mode="run-date" date={dateValue} />}
    </div>
  );
}

export default function TestVerify({ state, update, onBack }: Props) {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const test = async () => {
    setTesting(true);
    setError('');
    update({ verifiedAccount: null });

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.jira),
      });
      const data = await res.json();

      if (data.ok) {
        update({ verifiedAccount: data.account });
      } else {
        setError(data.error || 'Verification failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection error');
    }

    setTesting(false);
  };

  const { verifiedAccount } = state;

  const isGoogleSheets = state.sources.includes('google-sheets');
  const isGoogleDocs = state.sources.includes('google-docs');
  const isGoogleSource = isGoogleSheets || isGoogleDocs;
  const googleUrl = state.googleSourceUrl?.trim() || '';
  const logPath = `~/.jira-time-tracker/logs/jira-time-tracker.log`;

  return (
    <PageShell
      badge="Step 7 of 7"
      title="Test & Verify"
      subtitle="Confirm your Jira credentials are working, then review how to use your new time tracker."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
        </>
      }
    >
      <div style={{ maxWidth: 560 }} className="space-y-6">
        {/* Connection test */}
        <div>
          <button className="btn-primary" onClick={test} disabled={testing}>
            {testing ? 'Testing connection...' : 'Test Jira Connection'}
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg flex items-start gap-3" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)' }}>
            <span style={{ color: '#f85149', fontSize: 16 }}>✗</span>
            <div>
              <div className="text-sm font-semibold mb-1" style={{ color: '#f85149' }}>Connection failed</div>
              <div className="text-xs" style={{ color: '#8b949e' }}>{error}</div>
              <div className="text-xs mt-2" style={{ color: '#484f58' }}>
                Check your Atlassian URL, email, and API token on the previous step.
              </div>
            </div>
          </div>
        )}

        {!verifiedAccount && !error && (
          <div className="p-4 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <div className="text-xs" style={{ color: '#484f58' }}>
              Click the button above to verify your Jira connection. This makes a test API call to{' '}
              <code style={{ color: '#79c0ff' }}>/rest/api/3/myself</code> using your saved credentials.
            </div>
          </div>
        )}

        {verifiedAccount && (
          <>
            {/* Verified account card */}
            <div className="p-4 rounded-lg" style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)' }}>
              <div className="flex items-center gap-3 mb-4">
                <span style={{ color: '#56d364', fontSize: 18 }}>✓</span>
                <span className="text-sm font-semibold" style={{ color: '#56d364' }}>Connected successfully</span>
              </div>
              <div className="flex items-center gap-3">
                {verifiedAccount.avatarUrl && (
                  <img src={verifiedAccount.avatarUrl} alt="" className="w-10 h-10 rounded-full" style={{ border: '2px solid #30363d' }} />
                )}
                <div>
                  <div className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{verifiedAccount.displayName}</div>
                  <div className="text-xs" style={{ color: '#8b949e' }}>{verifiedAccount.email}</div>
                </div>
              </div>
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(22,163,74,0.2)' }}>
                <div className="text-xs" style={{ color: '#8b949e' }}>
                  ✓ API token is valid<br />
                  ✓ Jira Cloud connection established<br />
                  ✓ Ready to log time entries
                </div>
              </div>
            </div>

            {/* Setup complete hero */}
            <div className="pt-2">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)' }}>
                <span className="text-xl">✓</span>
              </div>
              <h2 className="text-2xl font-bold mb-1" style={{ color: '#e6edf3', letterSpacing: '-0.02em' }}>Setup Complete</h2>
              <p className="text-sm mb-5" style={{ color: '#8b949e' }}>Your Jira time tracker is configured and ready to use.</p>

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { icon: '⚙', label: 'Approach', value: 'Cron (launchd)' },
                  { icon: '📂', label: 'Sources', value: state.sources.length > 0 ? state.sources.join(', ') : '—' },
                  { icon: '👤', label: 'Jira Account', value: verifiedAccount.displayName || state.jira.email || '—' },
                ].map((card) => (
                  <div key={card.label} className="p-4 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                    <div className="text-lg mb-1">{card.icon}</div>
                    <div className="text-xs mb-1" style={{ color: '#8b949e' }}>{card.label}</div>
                    <div className="text-xs font-semibold" style={{ color: '#e6edf3' }}>{card.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Automatic logging */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Automatic daily logging</div>
              <div className="p-3 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
                <div className="text-xs leading-relaxed mb-2" style={{ color: '#8b949e' }}>
                  launchd will run at{' '}
                  <strong style={{ color: '#e6edf3' }}>{state.schedule?.time || '17:00'}</strong> on{' '}
                  <strong style={{ color: '#e6edf3' }}>{(state.schedule?.days || []).join(', ')}</strong> and automatically log your time entries to Jira.
                </div>
                <div className="text-xs" style={{ color: '#484f58' }}>
                  Logs: <code style={{ color: '#79c0ff' }}>{logPath}</code>
                </div>
              </div>
            </div>

            {/* Dry run */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Dry run — preview without posting</div>
              <RunButton label="Dry Run" mode="dry-run" />
            </div>

            {/* Manual trigger */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Manual trigger — parse and post to Jira</div>
              <RunButton label="Run Now" mode="run" />
            </div>

            {/* Specific date */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Log for a specific date</div>
              <DateRunButton />
            </div>

            {/* Google Drive note */}
            {isGoogleSource && (
              <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.3)' }}>
                <span className="text-xs mt-0.5" style={{ color: '#79c0ff' }}>📊</span>
                <div>
                  <div className="text-xs font-semibold mb-1" style={{ color: '#79c0ff' }}>Google Drive integration</div>
                  <div className="text-xs leading-relaxed" style={{ color: '#484f58' }}>
                    The script reads from your linked {isGoogleSheets ? 'Google Sheet' : 'Google Doc'} using the <code style={{ color: '#79c0ff' }}>gws</code> CLI.
                    {googleUrl && (
                      <span className="block mt-1 font-mono truncate" style={{ color: '#8b949e' }}>Linked: {googleUrl}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Custom rules note */}
            {state.customRules && state.customRules.length > 0 && (
              <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: 'rgba(227,179,65,0.06)', border: '1px solid rgba(227,179,65,0.25)' }}>
                <span className="text-xs mt-0.5" style={{ color: '#e3b341' }}>⚡</span>
                <div>
                  <div className="text-xs font-semibold mb-1" style={{ color: '#e3b341' }}>Custom rules active</div>
                  <div className="text-xs leading-relaxed" style={{ color: '#484f58' }}>
                    {state.customRules.length} custom rule{state.customRules.length !== 1 ? 's are' : ' is'} saved to your config and take priority over defaults.
                    Edit <code style={{ color: '#79c0ff' }}>~/.jira-time-tracker/config.json</code> to add or remove rules at any time.
                  </div>
                </div>
              </div>
            )}

            {/* Config location */}
            <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: '#161b22', border: '1px solid #30363d' }}>
              <span className="text-xs mt-0.5" style={{ color: '#e3b341' }}>📁</span>
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>Configuration file</div>
                <code className="text-xs" style={{ color: '#79c0ff' }}>~/.jira-time-tracker/config.json</code>
                <div className="text-xs mt-1" style={{ color: '#484f58' }}>
                  Edit this file to update credentials, charge codes, custom rules, or schedule at any time.
                </div>
              </div>
            </div>

            {/* Close */}
            <div className="pt-2 flex items-center gap-3" style={{ borderTop: '1px solid #30363d' }}>
              <button className="btn-ghost text-xs" onClick={() => window.close()}>
                Close Wizard
              </button>
              <span className="text-xs" style={{ color: '#484f58' }}>
                You can re-run setup.sh at any time to update your configuration.
              </span>
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
