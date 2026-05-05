import { useState } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function JiraCredentials({ state, update, onNext, onBack }: Props) {
  const [showToken, setShowToken] = useState(false);
  const { jira } = state;

  const set = (key: keyof typeof jira, val: string) =>
    update({ jira: { ...jira, [key]: val } });

  const isValid = jira.url.startsWith('https://') && jira.email.includes('@') && jira.token.length > 10;

  return (
    <PageShell
      badge="Step 3 of 9"
      title="Jira Credentials"
      subtitle="Your credentials are stored locally in ~/.jira-time-tracker/config.json and never leave your machine."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!isValid} onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div className="space-y-5" style={{ maxWidth: 520 }}>
        {/* Atlassian URL */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
            Atlassian URL
          </label>
          <input
            className="wizard-input"
            type="url"
            placeholder="https://yourteam.atlassian.net"
            value={jira.url}
            onChange={(e) => set('url', e.target.value)}
          />
          <p className="text-xs mt-1.5" style={{ color: '#484f58' }}>
            Your Atlassian Cloud base URL — no trailing slash.
          </p>
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
            Atlassian Email
          </label>
          <input
            className="wizard-input"
            type="email"
            placeholder="you@company.com"
            value={jira.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>

        {/* API Token */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>
            API Token
          </label>
          <div className="relative">
            <input
              className="wizard-input pr-16"
              type={showToken ? 'text' : 'password'}
              placeholder="ATATT3xFfGF0..."
              value={jira.token}
              onChange={(e) => set('token', e.target.value)}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: '#484f58' }}>
            Generate at{' '}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#79c0ff' }}
            >
              id.atlassian.com/manage-profile/security/api-tokens
            </a>
          </p>
        </div>

        {/* Security note */}
        <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: '#161b22', border: '1px solid #30363d' }}>
          <span className="text-xs mt-0.5" style={{ color: '#e3b341' }}>🔒</span>
          <p className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>
            Credentials are stored in{' '}
            <code className="px-1 rounded" style={{ background: '#0d1117', color: '#79c0ff' }}>
              ~/.jira-time-tracker/config.json
            </code>{' '}
            with 600 permissions (owner read/write only). They are never transmitted to any third party.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
