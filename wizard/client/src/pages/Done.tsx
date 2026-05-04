import { useState } from 'react';
import { type WizardState } from '../App';

interface Props { state: WizardState; }

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: '#010409', border: '1px solid #30363d' }}>
      <pre className="text-xs p-4 overflow-x-auto" style={{ color: '#7ee787', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 text-xs px-2 py-1 rounded"
        style={{ background: '#161b22', border: '1px solid #30363d', color: copied ? '#56d364' : '#8b949e', cursor: 'pointer' }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function Done({ state }: Props) {
  const pythonBin = '/usr/bin/python3';
  const wizardDir = '~/JiraTimeTracker';
  const gdrivScript = '~/skills/jira-time-tracker/scripts/log_from_gdrive.py';

  const isGoogleSheets = state.sources.includes('google-sheets');
  const isGoogleDocs = state.sources.includes('google-docs');
  const isGoogleSource = isGoogleSheets || isGoogleDocs;
  const googleUrl = state.googleSourceUrl?.trim() || '';

  // Build the primary run command based on source
  let manualCommand: string;
  let dryRunCommand: string;
  let specificDateCommand: string;

  if (isGoogleSource && googleUrl) {
    const flag = isGoogleSheets ? '--sheet' : '--doc';
    manualCommand = `${pythonBin} ${gdrivScript} ${flag} "${googleUrl}"`;
    dryRunCommand = `${pythonBin} ${gdrivScript} ${flag} "${googleUrl}" --dry-run`;
    specificDateCommand = `${pythonBin} ${gdrivScript} ${flag} "${googleUrl}" --date 2026-04-25`;
  } else if (isGoogleSource) {
    const flag = isGoogleSheets ? '--sheet' : '--doc';
    manualCommand = `${pythonBin} ${gdrivScript} ${flag} <YOUR_${isGoogleSheets ? 'SHEET' : 'DOC'}_ID_OR_URL>`;
    dryRunCommand = `${pythonBin} ${gdrivScript} ${flag} <ID> --dry-run`;
    specificDateCommand = `${pythonBin} ${gdrivScript} ${flag} <ID> --date 2026-04-25`;
  } else {
    manualCommand = `${pythonBin} ${wizardDir}/log-time.py`;
    dryRunCommand = `${pythonBin} ${wizardDir}/log-time.py --dry-run`;
    specificDateCommand = `${pythonBin} ${wizardDir}/log-time.py --date 2026-04-25`;
  }

  const logPath = `~/.jira-time-tracker/logs/jira-time-tracker.log`;

  return (
    <div className="flex flex-col h-full px-10 py-8">
      {/* Hero */}
      <div className="mb-8">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(22,163,74,0.15)', border: '1px solid rgba(22,163,74,0.3)' }}>
          <span className="text-2xl">✓</span>
        </div>
        <h1 className="text-3xl font-bold mb-2" style={{ color: '#e6edf3', letterSpacing: '-0.02em' }}>
          Setup Complete
        </h1>
        <p className="text-sm" style={{ color: '#8b949e' }}>
          Your Jira time tracker is configured and ready to use.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { icon: '⚙', label: 'Approach', value: 'Cron (launchd)' },
          { icon: '📂', label: 'Sources', value: state.sources.length > 0 ? state.sources.join(', ') : '—' },
          { icon: '👤', label: 'Jira Account', value: state.verifiedAccount?.displayName || state.jira.email || '—' },
        ].map((card) => (
          <div key={card.label} className="p-4 rounded-lg" style={{ background: '#161b22', border: '1px solid #30363d' }}>
            <div className="text-lg mb-1">{card.icon}</div>
            <div className="text-xs mb-1" style={{ color: '#8b949e' }}>{card.label}</div>
            <div className="text-xs font-semibold" style={{ color: '#e6edf3' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Next steps */}
      <div className="flex-1 space-y-5 overflow-y-auto">

        {/* Automatic logging */}
        <div>
          <div className="text-xs font-semibold mb-3" style={{ color: '#8b949e' }}>Automatic daily logging</div>
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

        {/* Manual trigger */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Manual trigger — run anytime</div>
          <CopyBlock code={manualCommand} />
        </div>

        {/* Dry run */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Dry run — preview without posting</div>
          <CopyBlock code={dryRunCommand} />
        </div>

        {/* Specific date */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Log for a specific date</div>
          <CopyBlock code={specificDateCommand} />
        </div>

        {/* Google Drive note */}
        {isGoogleSource && (
          <div className="p-3 rounded-lg flex items-start gap-2" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.3)' }}>
            <span className="text-xs mt-0.5" style={{ color: '#79c0ff' }}>📊</span>
            <div>
              <div className="text-xs font-semibold mb-1" style={{ color: '#79c0ff' }}>Google Drive integration</div>
              <div className="text-xs leading-relaxed" style={{ color: '#484f58' }}>
                The script reads from your linked {isGoogleSheets ? 'Google Sheet' : 'Google Doc'} using the <code style={{ color: '#79c0ff' }}>gws</code> CLI.
                All existing rules apply: time range parsing (<code style={{ color: '#79c0ff' }}>9:15--&gt;10:00</code>),
                charge code shorthands (<code style={{ color: '#79c0ff' }}>ai</code>, <code style={{ color: '#79c0ff' }}>cr fceh</code>, <code style={{ color: '#79c0ff' }}>standup</code>),
                same-day ticket merging, and the one-standup-per-day rule.
                See <code style={{ color: '#79c0ff' }}>Google_Drive_Integration.md</code> in the skill folder for full format details.
              </div>
              {googleUrl && (
                <div className="text-xs mt-2 font-mono truncate" style={{ color: '#8b949e' }}>
                  Linked: {googleUrl}
                </div>
              )}
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
                {state.customRules.length} custom rule{state.customRules.length !== 1 ? 's are' : ' is'} saved to your config.
                These are checked <strong style={{ color: '#8b949e' }}>before</strong> the default RR and code review rules,
                so they take priority when a description matches. Edit{' '}
                <code style={{ color: '#79c0ff' }}>~/.jira-time-tracker/config.json</code> to add or remove rules at any time.
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
      </div>

      <div className="mt-6 pt-4 flex items-center gap-3" style={{ borderTop: '1px solid #30363d' }}>
        <button
          className="btn-ghost text-xs"
          onClick={() => window.close()}
        >
          Close Wizard
        </button>
        <span className="text-xs" style={{ color: '#484f58' }}>
          You can re-run setup.sh at any time to update your configuration.
        </span>
      </div>
    </div>
  );
}
