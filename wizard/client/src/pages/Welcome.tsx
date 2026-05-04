interface WelcomeProps { onNext: () => void; }

export default function Welcome({ onNext }: WelcomeProps) {
  return (
    <div className="flex flex-col items-start justify-center h-full px-10 py-8">
      <span className="badge badge-blue mb-4">Setup Wizard</span>

      <h1 className="text-4xl font-bold mb-3" style={{ color: '#e6edf3', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
        Automated Jira<br />Time Tracking
      </h1>

      <p className="text-sm leading-relaxed mb-8" style={{ color: '#8b949e', maxWidth: 480 }}>
        Stop manually logging hours in Jira. This wizard configures{' '}
        <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: '#161b22', color: '#79c0ff', border: '1px solid #30363d' }}>
          mcp-atlassian
        </code>{' '}
        and connects it to your preferred AI workflow — in under 10 minutes.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-10 w-full" style={{ maxWidth: 560 }}>
        {[
          { icon: '🕐', title: 'Log time naturally', desc: 'Paste your task notes — AI parses the issue key, time, and comment automatically.' },
          { icon: '⚡', title: '73 Jira tools', desc: 'Search, create, update, transition issues, manage sprints, and write Confluence pages.' },
          { icon: '🔀', title: 'Multiple sources', desc: 'Sticky Notes, Mac Notes, Google Docs, or Google Sheets — your choice.' },
        ].map((f) => (
          <div key={f.title} className="select-card" style={{ cursor: 'default' }}>
            <div className="text-xl mb-2">{f.icon}</div>
            <div className="text-xs font-semibold mb-1" style={{ color: '#e6edf3' }}>{f.title}</div>
            <div className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-8 p-3 rounded-lg w-full" style={{ maxWidth: 560, background: '#161b22', border: '1px solid #30363d' }}>
        <span style={{ color: '#e3b341' }}>☆</span>
        <p className="text-xs" style={{ color: '#8b949e' }}>
          This wizard was generated from a real working setup. The{' '}
          <code className="px-1 rounded" style={{ background: '#0d1117', color: '#79c0ff' }}>mcp-atlassian</code>{' '}
          server is already proven against Atlassian Cloud — just follow the steps.
        </p>
      </div>

      <button className="btn-primary" onClick={onNext}>
        Get Started →
      </button>
    </div>
  );
}
