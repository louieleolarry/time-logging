import { useState } from 'react';
import { type WizardState } from '../App';
import PageShell from '../components/PageShell';

interface Props {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Configure({ state, update, onNext, onBack }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const { schedule } = state;

  const toggleDay = (day: string) => {
    const days = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day];
    update({ schedule: { ...schedule, days } });
  };

  const save = async () => {
    setSaving(true);
    setError('');

    try {
      // 1. Save config
      const configRes = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira: state.jira,
          approach: 'cron',
          sources: state.sources,
          charge_codes: state.chargeCodes,
          custom_rules: state.customRules,
          google_source_url: state.googleSourceUrl || undefined,
          schedule: state.schedule,
        }),
      });
      const configData = await configRes.json();
      if (!configData.ok) throw new Error(configData.error);

      // 2. Set up launchd (always cron)
      {
        const launchdRes = await fetch('/api/launchd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state.schedule),
        });
        const launchdData = await launchdRes.json();
        if (!launchdData.ok) throw new Error(launchdData.error);
      }

      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setSaving(false);
  };

  return (
    <PageShell
      badge="Step 6 of 8"
      title="Configure"
      subtitle="Review your settings and save the configuration to your Mac."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!saved} onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div className="space-y-5" style={{ maxWidth: 560 }}>
        {/* Config summary */}
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #30363d' }}>
          <div className="px-4 py-3" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
            <span className="text-xs font-semibold" style={{ color: '#8b949e' }}>Configuration Summary</span>
          </div>
          {[
            { label: 'Approach', value: 'Cron (launchd)' },
            { label: 'Sources', value: state.sources.join(', ') || '—' },
            { label: 'Jira URL', value: state.jira.url || '—' },
            { label: 'Email', value: state.jira.email || '—' },
            { label: 'API Token', value: state.jira.token ? '••••••••' + state.jira.token.slice(-4) : '—' },
            { label: 'RR Codes', value: state.chargeCodes.rapid_response.map((c) => c.key).join(', ') || '—' },
            { label: 'Standup Codes', value: state.chargeCodes.standup.map((c) => c.key).join(', ') || '—' },
            { label: 'Code Review Codes', value: state.chargeCodes.code_review.map((c) => c.key).join(', ') || '—' },
            { label: 'Custom Rules', value: state.customRules.length > 0 ? `${state.customRules.length} rule${state.customRules.length !== 1 ? 's' : ''}` : 'None (defaults apply)' },
            ...(state.googleSourceUrl ? [{ label: 'Google Source', value: state.googleSourceUrl }] : []),
          ].map((row, i) => (
            <div key={row.label} className="flex px-4 py-2.5" style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)', borderTop: '1px solid #30363d' }}>
              <span className="text-xs w-40 flex-shrink-0" style={{ color: '#8b949e' }}>{row.label}</span>
              <span className="text-xs font-mono" style={{ color: '#e6edf3' }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Schedule */}
        {
          <div className="rounded-lg p-4" style={{ border: '1px solid #30363d', background: '#161b22' }}>
            <div className="text-xs font-semibold mb-3" style={{ color: '#8b949e' }}>Logging Schedule</div>

            <div className="flex items-center gap-4 mb-4">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: '#484f58' }}>Time</label>
                <input
                  className="wizard-input"
                  type="time"
                  value={schedule.time}
                  onChange={(e) => update({ schedule: { ...schedule, time: e.target.value } })}
                  style={{ width: 120 }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs mb-2" style={{ color: '#484f58' }}>Days</label>
              <div className="flex gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className="text-xs px-3 py-1.5 rounded font-medium transition-all"
                    style={{
                      background: schedule.days.includes(day) ? 'rgba(37,99,235,0.2)' : '#0d1117',
                      border: `1px solid ${schedule.days.includes(day) ? '#2563eb' : '#30363d'}`,
                      color: schedule.days.includes(day) ? '#79c0ff' : '#484f58',
                    }}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs mt-3" style={{ color: '#484f58' }}>
              A launchd agent will be installed at{' '}
              <code style={{ color: '#79c0ff' }}>~/Library/LaunchAgents/com.jira-time-tracker.daily.plist</code>
            </p>
          </div>
        }

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving || saved}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Configuration'}
          </button>
          {saved && <span className="text-xs" style={{ color: '#56d364' }}>Config written to ~/.jira-time-tracker/config.json</span>}
          {error && <span className="text-xs" style={{ color: '#f85149' }}>{error}</span>}
        </div>
      </div>
    </PageShell>
  );
}
