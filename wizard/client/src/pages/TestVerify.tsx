import { useState } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function TestVerify({ state, update, onNext, onBack }: Props) {
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

  return (
    <PageShell
      badge="Step 8 of 9"
      title="Test & Verify"
      subtitle="Confirm that your Jira credentials are working before completing setup."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!verifiedAccount} onClick={onNext}>
            Continue →
          </button>
        </>
      }
    >
      <div style={{ maxWidth: 520 }}>
        <button className="btn-primary mb-6" onClick={test} disabled={testing}>
          {testing ? 'Testing connection...' : 'Test Jira Connection'}
        </button>

        {error && (
          <div className="mb-4 p-4 rounded-lg flex items-start gap-3" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)' }}>
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

        {verifiedAccount && (
          <div className="p-4 rounded-lg" style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)' }}>
            <div className="flex items-center gap-3 mb-4">
              <span style={{ color: '#56d364', fontSize: 18 }}>✓</span>
              <span className="text-sm font-semibold" style={{ color: '#56d364' }}>Connected successfully</span>
            </div>

            <div className="flex items-center gap-3">
              {verifiedAccount.avatarUrl && (
                <img
                  src={verifiedAccount.avatarUrl}
                  alt=""
                  className="w-10 h-10 rounded-full"
                  style={{ border: '2px solid #30363d' }}
                />
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
        )}

        {!verifiedAccount && !error && (
          <div className="p-4 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <div className="text-xs" style={{ color: '#484f58' }}>
              Click the button above to verify your Jira connection. This makes a test API call to{' '}
              <code style={{ color: '#79c0ff' }}>/rest/api/3/myself</code> using your saved credentials.
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
