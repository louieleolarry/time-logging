import { useState, useRef, useEffect } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

interface LogLine { type: string; text: string; }

// Step index for Install Dependencies in the STEPS array (0-based: Welcome=0, ChooseSource=1, JiraCredentials=2, InstallDeps=3)
const INSTALL_STEP_INDEX = 3;

export default function InstallDeps({ state, update, onNext, onBack }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  // Initialize from persisted stepStatus so navigating back restores the result
  const [done, setDone] = useState(() => state.stepStatus[INSTALL_STEP_INDEX] === 'success' || state.stepStatus[INSTALL_STEP_INDEX] === 'error');
  const [hasError, setHasError] = useState(() => state.stepStatus[INSTALL_STEP_INDEX] === 'error');
  const termRef = useRef<HTMLDivElement>(null);

  const append = (type: string, text: string) =>
    setLines((l) => [...l, { type, text }]);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [lines]);

  const runInstall = async () => {
    setRunning(true);
    setLines([]);
    setDone(false);
    setHasError(false);
    let localError = false;

    try {
      const res = await fetch('/api/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: state.sources }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          try {
            const msg = JSON.parse(part.slice(6));
            if (msg.type === 'step') {
              append('step', `\n[${msg.data.index}/${msg.data.total}] ${msg.data.label}`);
            } else if (msg.type === 'stdout') {
              append('stdout', msg.data.text);
            } else if (msg.type === 'stderr') {
              append('stderr', msg.data.text);
            } else if (msg.type === 'success') {
              append('success', `✓ ${msg.data.label}`);
            } else if (msg.type === 'error') {
              append('error', `✗ ${msg.data.label}: ${msg.data.message || `exit ${msg.data.code}`}`);
              setHasError(true);
              localError = true;
            } else if (msg.type === 'done') {
              append('done', `\n✅ ${msg.data.message}`);
              setDone(true);
              // Report status to sidebar using localError (avoids stale closure)
              update({
                stepStatus: {
                  ...state.stepStatus,
                  [INSTALL_STEP_INDEX]: localError ? 'error' : 'success',
                },
              });
            }
          } catch {}
        }
      }
    } catch (err) {
      append('error', `Connection error: ${err}`);
      setHasError(true);
    }

    setRunning(false);
  };

  return (
    <PageShell
      badge="Step 4 of 7"
      title="Install Dependencies"
      subtitle="The wizard will install the required packages for your selected sources. Click Install to begin."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack} disabled={running}>← Back</button>
          <button className="btn-primary" disabled={!done} onClick={onNext}>Continue →</button>
        </>
      }
    >
      {/* What will be installed */}
      <div className="mb-5 p-4 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <div className="text-xs font-semibold mb-3" style={{ color: '#8b949e' }}>Packages to install:</div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="badge badge-blue">always</span>
            <code className="text-xs" style={{ color: '#79c0ff' }}>requests</code>
            <span className="text-xs" style={{ color: '#484f58' }}>— HTTP client for Jira REST API</span>
          </div>
          {state.sources.includes('mac-notes') && (
            <div className="flex items-center gap-2">
              <span className="badge badge-yellow">mac-notes</span>
              <code className="text-xs" style={{ color: '#79c0ff' }}>macnotesapp</code>
              <span className="text-xs" style={{ color: '#484f58' }}>— Mac Notes reader (via /usr/bin/pip3)</span>
            </div>
          )}
          {(state.sources.includes('google-sheets') || state.sources.includes('google-docs')) && (
            <div className="flex items-center gap-2">
              <span className="badge badge-green">google</span>
              <code className="text-xs" style={{ color: '#79c0ff' }}>google-api-python-client</code>
              <span className="text-xs" style={{ color: '#484f58' }}>— Google API client libraries</span>
            </div>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="terminal mb-4" style={{ minHeight: 180 }}>
        {lines.length === 0 && !running && (
          <span style={{ color: '#484f58' }}>$ Ready to install — click the button below</span>
        )}
        {lines.map((line, i) => (
          <div key={i} className={line.type === 'stderr' || line.type === 'error' ? 'stderr' : line.type === 'step' ? 'step' : line.type === 'done' ? 'done' : ''}>
            {line.text}
          </div>
        ))}
        {running && <span className="animate-pulse" style={{ color: '#484f58' }}>▊</span>}
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={runInstall}
          disabled={running}
        >
          {running ? 'Installing...' : done ? 'Re-run Install' : 'Install Dependencies'}
        </button>
        {hasError && !running && (
          <span className="text-xs" style={{ color: '#f85149' }}>
            Some packages had errors — you can continue or retry.
          </span>
        )}
        {done && !hasError && (
          <span className="text-xs" style={{ color: '#56d364' }}>
            ✓ All dependencies installed successfully
          </span>
        )}
      </div>
    </PageShell>
  );
}
