import { type WizardState, type Source } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

const sources: { id: Source; icon: string; title: string; desc: string; format: string; note?: string }[] = [
  {
    id: 'stickies',
    icon: '🟡',
    title: 'macOS Sticky Notes',
    desc: 'Reads the most recently modified sticky note that contains time entries.',
    format: '9:00-->10:30 FCEH-109 rapid response triage',
    note: 'Uses AppleScript to read Stickies.app',
  },
  {
    id: 'mac-notes',
    icon: '📝',
    title: 'Mac Notes',
    desc: 'Reads the most recently modified note in Notes.app that contains a date, time range, and task.',
    format: 'April 25\n9:00-->10:30 FCEH-109 standup',
    note: 'Requires macnotesapp (auto-installed)',
  },
  {
    id: 'google-sheets',
    icon: '📊',
    title: 'Google Sheets',
    desc: 'Reads time entries from a designated sheet. Each row should have date, start time, end time, and task.',
    format: 'Date | Start | End | Issue | Comment',
    note: 'Requires Google OAuth setup (guided)',
  },
  {
    id: 'google-docs',
    icon: '📄',
    title: 'Google Docs',
    desc: 'Reads a Google Doc containing time entries in the same format as sticky notes.',
    format: '9:00-->10:30 FCEH-109 rapid response',
    note: 'Requires Google OAuth setup (guided)',
  },
];

const GOOGLE_SOURCES: Source[] = ['google-sheets', 'google-docs'];

export default function ChooseSource({ state, update, onNext, onBack }: Props) {
  const selected = state.sources;
  const hasGoogle = selected.some((id) => GOOGLE_SOURCES.includes(id));

  const toggle = (id: Source) => {
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : [...selected, id];
    update({ sources: next });
  };

  const googleSourceLabel =
    selected.includes('google-sheets') && selected.includes('google-docs')
      ? 'Google Sheet or Doc URL / ID'
      : selected.includes('google-sheets')
      ? 'Google Sheet URL or ID'
      : 'Google Doc URL or ID';

  const googleSourcePlaceholder = selected.includes('google-sheets')
    ? 'https://docs.google.com/spreadsheets/d/... or spreadsheet ID'
    : 'https://docs.google.com/document/d/... or document ID';

  const canContinue = selected.length > 0 && (!hasGoogle || state.googleSourceUrl.trim().length > 0);

  return (
    <PageShell
      badge="Step 3 of 9"
      title="Choose Your Time Entry Source"
      subtitle="Select one or more sources where you record your daily time entries. You can enable multiple sources — the most recently modified one will be used each day."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!canContinue} onClick={onNext}>
            Continue →
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Source cards */}
        <div className="grid grid-cols-2 gap-4">
          {sources.map((s) => {
            const isSelected = selected.includes(s.id);
            return (
              <div
                key={s.id}
                className={`select-card ${isSelected ? 'selected' : ''}`}
                onClick={() => toggle(s.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{s.icon}</span>
                    <span className="font-semibold text-sm" style={{ color: '#e6edf3' }}>{s.title}</span>
                  </div>
                  {/* Checkbox */}
                  <div
                    className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      border: `2px solid ${isSelected ? '#2563eb' : '#30363d'}`,
                      background: isSelected ? '#2563eb' : 'transparent',
                    }}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                </div>

                <p className="text-xs leading-relaxed mb-3" style={{ color: '#8b949e' }}>{s.desc}</p>

                <div className="rounded p-2 mb-3" style={{ background: '#010409', border: '1px solid #30363d' }}>
                  <div className="text-xs mb-1" style={{ color: '#484f58' }}>Expected format:</div>
                  <pre className="text-xs whitespace-pre-wrap" style={{ color: '#7ee787', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
                    {s.format}
                  </pre>
                </div>

                {s.note && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs" style={{ color: '#484f58' }}>ℹ</span>
                    <span className="text-xs" style={{ color: '#484f58' }}>{s.note}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Google source URL — shown only when a Google source is selected */}
        {hasGoogle && (
          <div
            className="rounded-lg p-4"
            style={{ border: '1px solid rgba(37,99,235,0.4)', background: 'rgba(37,99,235,0.06)' }}
          >
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#79c0ff' }}>
              {googleSourceLabel}
            </label>
            <p className="text-xs mb-3 leading-relaxed" style={{ color: '#484f58' }}>
              Paste the full URL or just the file ID. This will be saved to your config so the script
              knows which document to read from each day.
            </p>
            <input
              className="wizard-input font-mono text-xs"
              type="text"
              placeholder={googleSourcePlaceholder}
              value={state.googleSourceUrl}
              onChange={(e) => update({ googleSourceUrl: e.target.value })}
            />
            {state.googleSourceUrl.trim() && (
              <p className="text-xs mt-2" style={{ color: '#56d364' }}>✓ Source linked</p>
            )}
          </div>
        )}

        {/* Selection summary */}
        {selected.length > 0 && (
          <div className="p-3 rounded-lg flex items-center gap-2" style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.3)' }}>
            <span style={{ color: '#56d364' }}>✓</span>
            <span className="text-xs" style={{ color: '#56d364' }}>
              {selected.length} source{selected.length > 1 ? 's' : ''} selected:{' '}
              {selected.map((s) => sources.find((x) => x.id === s)?.title).join(', ')}
            </span>
          </div>
        )}
      </div>
    </PageShell>
  );
}
