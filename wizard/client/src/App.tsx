import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/Sidebar';
import Welcome from './pages/Welcome';
import ChooseSource from './pages/ChooseSource';
import JiraCredentials from './pages/JiraCredentials';
import ChargeCodes from './pages/ChargeCodes';
import InstallDeps from './pages/InstallDeps';
import TestVerify from './pages/TestVerify';


export type Source = 'stickies' | 'mac-notes' | 'google-sheets' | 'google-docs';

export interface CustomRule {
  keyword: string;
  key: string;
  label: string;
}

export interface KeywordMapping {
  keyword: string;
  key: string;
  label: string;
}

export interface ParsingRulesConfig {
  skipPatterns: string[];
  keywordMappings: KeywordMapping[];
  openEndedTimeBehavior: 'fill_day' | 'fixed_15m';
  targetHoursPerDay: number;
}

export interface WizardState {
  sources: Source[];
  jira: { url: string; email: string; token: string };
  chargeCodes: {
    rapid_response: { label: string; key: string }[];
    standup: { label: string; key: string }[];
    code_review: { label: string; key: string }[];
  };
  customRules: CustomRule[];
  parsingRules: ParsingRulesConfig;
  /** URL or ID of the linked Google Sheet or Google Doc (when a Google source is selected). */
  googleSourceUrl: string;
  schedule: { time: string; days: string[] };
  verifiedAccount: { displayName: string; email: string; avatarUrl?: string } | null;
  /** Per-step status overrides: 'success' | 'error' | undefined */
  stepStatus: Record<number, 'success' | 'error'>;
}

// 7-step order: Welcome, Choose Source, Jira Credentials, Install Dependencies,
// Charge Codes, Schedule (+ config summary + save), Test & Verify (+ Done)
export const STEPS = [
  'Welcome',
  'Choose Source',
  'Jira Credentials',
  'Install Dependencies',
  'Charge Codes',
  'Schedule',
  'Test & Verify',
];

// Index of the Done step — used to jump here when already configured
const DONE_STEP = STEPS.length - 1;

const defaultParsingRules: ParsingRulesConfig = {
  skipPatterns: [],
  keywordMappings: [],
  openEndedTimeBehavior: 'fill_day',
  targetHoursPerDay: 8.25,
};

const defaultState: WizardState = {
  sources: [],
  jira: { url: '', email: '', token: '' },
  chargeCodes: { rapid_response: [], standup: [], code_review: [] },
  customRules: [],
  parsingRules: defaultParsingRules,
  googleSourceUrl: '',
  schedule: { time: '17:30', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
  verifiedAccount: null,
  stepStatus: {},
};

/** Map a raw config.json object onto WizardState, filling gaps with defaults. */
function hydrateState(config: Record<string, unknown>): WizardState {
  const s = { ...defaultState };

  if (Array.isArray(config.sources)) s.sources = config.sources as Source[];

  if (config.jira && typeof config.jira === 'object') {
    const j = config.jira as Record<string, string>;
    s.jira = { url: j.url ?? '', email: j.email ?? '', token: j.token ?? '' };
  }

  if (config.charge_codes && typeof config.charge_codes === 'object') {
    const cc = config.charge_codes as Record<string, { label: string; key: string }[]>;
    s.chargeCodes = {
      rapid_response: cc.rapid_response ?? [],
      standup: cc.standup ?? [],
      code_review: cc.code_review ?? [],
    };
  }

  if (Array.isArray(config.custom_rules)) {
    s.customRules = config.custom_rules as CustomRule[];
  }

  if (config.parsing_rules && typeof config.parsing_rules === 'object') {
    const pr = config.parsing_rules as Record<string, unknown>;
    s.parsingRules = {
      skipPatterns: Array.isArray(pr.skip_patterns) ? pr.skip_patterns as string[] : [],
      keywordMappings: Array.isArray(pr.keyword_mappings) ? pr.keyword_mappings as KeywordMapping[] : [],
      openEndedTimeBehavior: (pr.open_ended_time_behavior as 'fill_day' | 'fixed_15m') ?? 'fill_day',
      targetHoursPerDay: typeof pr.target_hours_per_day === 'number' ? pr.target_hours_per_day : 8.25,
    };
  }

  if (typeof config.google_source_url === 'string') {
    s.googleSourceUrl = config.google_source_url;
  }

  if (config.schedule && typeof config.schedule === 'object') {
    const sc = config.schedule as Record<string, unknown>;
    s.schedule = {
      time: typeof sc.time === 'string' ? sc.time : defaultState.schedule.time,
      days: Array.isArray(sc.days) ? sc.days as string[] : defaultState.schedule.days,
    };
  }

  return s;
}

/** Returns true if the config has enough data to be considered "already configured". */
function isAlreadyConfigured(config: Record<string, unknown>): boolean {
  const jira = config.jira as Record<string, string> | undefined;
  return !!(jira?.url && jira?.email && jira?.token && Array.isArray(config.sources) && (config.sources as string[]).length > 0);
}

export default function App() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(defaultState);
  const [direction, setDirection] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.config) {
          setState(hydrateState(data.config));
          if (isAlreadyConfigured(data.config)) {
            setStep(DONE_STEP);
          }
        }
      })
      .catch(() => { /* no config yet */ })
      .finally(() => setHydrated(true));
  }, []);

  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }));

  const goTo = (i: number) => {
    setDirection(i > step ? 1 : -1);
    setStep(i);
  };
  const next = () => goTo(Math.min(step + 1, STEPS.length - 1));
  const back = () => goTo(Math.max(step - 1, 0));

  const pages = [
    <Welcome key="welcome" onNext={next} />,
    <ChooseSource key="source" state={state} update={update} onNext={next} onBack={back} />,
    <JiraCredentials key="jira" state={state} update={update} onNext={next} onBack={back} />,
    <InstallDeps key="install" state={state} update={update} onNext={next} onBack={back} />,
    <ChargeCodes key="codes" state={state} update={update} onNext={next} onBack={back} />,
    <ScheduleStep key="schedule" state={state} update={update} onNext={next} onBack={back} />,
    <TestVerify key="verify" state={state} update={update} onNext={next} onBack={back} />,
  ];

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
  };

  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: '#0d1117' }}>
        <span className="text-sm" style={{ color: '#484f58' }}>Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0d1117' }}>
      <Sidebar steps={STEPS} current={step} onNavigate={goTo} stepStatus={state.stepStatus} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-8 py-4 border-b" style={{ borderColor: '#30363d' }}>
          <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: '#2563eb' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <span className="font-semibold text-sm" style={{ color: '#e6edf3' }}>Jira Time Tracker</span>
          <span className="text-sm" style={{ color: '#8b949e' }}>·</span>
          <span className="text-sm" style={{ color: '#8b949e' }}>Setup Wizard</span>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto relative">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              className="absolute inset-0 overflow-y-auto"
            >
              {pages[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer progress bar */}
        <div className="flex items-center justify-between px-8 py-4 border-t" style={{ borderColor: '#30363d' }}>
          <span className="text-xs" style={{ color: '#8b949e' }}>{step + 1} / {STEPS.length}</span>
          <div className="flex gap-1.5 items-center">
            {STEPS.map((_, i) => (
              <div
                key={i}
                onClick={() => goTo(i)}
                className="h-1 rounded-full transition-all duration-300 cursor-pointer"
                style={{
                  width: i === step ? 24 : 6,
                  background: i < step ? '#16a34a' : i === step ? '#2563eb' : '#30363d',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inline Schedule + Configure step ───────────────────────────────────────
import { useState as useLocalState } from 'react';
import PageShell from './components/PageShell';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ScheduleStep({
  state,
  update,
  onNext,
  onBack,
}: {
  state: WizardState;
  update: (p: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { schedule } = state;
  const [saving, setSaving] = useLocalState(false);
  const [saved, setSaved] = useLocalState(false);
  const [saveError, setSaveError] = useLocalState('');

  const toggleDay = (day: string) => {
    const days = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day];
    update({ schedule: { ...schedule, days } });
  };

  const canSave = schedule.time.trim() !== '' && schedule.days.length > 0;

  const save = async () => {
    setSaving(true);
    setSaveError('');
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
          parsing_rules: {
            skip_patterns: state.parsingRules.skipPatterns,
            keyword_mappings: state.parsingRules.keywordMappings,
            open_ended_time_behavior: state.parsingRules.openEndedTimeBehavior,
            target_hours_per_day: state.parsingRules.targetHoursPerDay,
          },
          google_source_url: state.sources.some((s) => s.startsWith('google'))
            ? state.googleSourceUrl || undefined
            : undefined,
          schedule: state.schedule,
        }),
      });
      const configData = await configRes.json();
      if (!configData.ok) throw new Error(configData.error);

      // 2. Set up launchd
      const launchdRes = await fetch('/api/launchd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.schedule),
      });
      const launchdData = await launchdRes.json();
      if (!launchdData.ok) throw new Error(launchdData.error);

      setSaved(true);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const summaryRows = [
    { label: 'Approach', value: 'Cron (launchd)' },
    { label: 'Sources', value: state.sources.join(', ') || '—' },
    { label: 'Jira URL', value: state.jira.url || '—' },
    { label: 'Email', value: state.jira.email || '—' },
    { label: 'API Token', value: state.jira.token ? '••••••••' + state.jira.token.slice(-4) : '—' },
    { label: 'RR Codes', value: state.chargeCodes.rapid_response.map((c) => c.key).join(', ') || '—' },
    { label: 'Standup Codes', value: state.chargeCodes.standup.map((c) => c.key).join(', ') || '—' },
    { label: 'Code Review Codes', value: state.chargeCodes.code_review.map((c) => c.key).join(', ') || '—' },
    { label: 'Custom Rules', value: state.customRules.length > 0 ? `${state.customRules.length} rule${state.customRules.length !== 1 ? 's' : ''}` : 'None (defaults apply)' },
    { label: 'Skip Patterns', value: state.parsingRules.skipPatterns.length > 0 ? state.parsingRules.skipPatterns.join(', ') : 'None' },
    { label: 'Keyword Mappings', value: state.parsingRules.keywordMappings.length > 0 ? `${state.parsingRules.keywordMappings.length} mapping${state.parsingRules.keywordMappings.length !== 1 ? 's' : ''}` : 'None' },
    { label: 'Open-ended Time', value: state.parsingRules.openEndedTimeBehavior === 'fill_day' ? `Fill to ${state.parsingRules.targetHoursPerDay}h/day` : 'Fixed 15m' },
    ...(state.googleSourceUrl && state.sources.some((s) => s.startsWith('google'))
      ? [{ label: 'Google Source', value: state.googleSourceUrl }]
      : []),
  ];

  return (
    <PageShell
      badge="Step 6 of 7"
      title="Schedule"
      subtitle="Choose when the time logger runs automatically. Review your settings below and save to finish setup."
      footer={
        <>
          <button className="btn-ghost" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!saved} onClick={onNext}>Continue →</button>
        </>
      }
    >
      <div style={{ maxWidth: 560 }} className="space-y-6">
        {/* Time + Days */}
        <div className="rounded-lg p-4 space-y-5" style={{ border: '1px solid #30363d', background: '#161b22' }}>
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: '#8b949e' }}>Time</label>
            <input
              type="time"
              className="wizard-input"
              style={{ width: 160, fontFamily: 'JetBrains Mono, monospace' }}
              value={schedule.time}
              onChange={(e) => update({ schedule: { ...schedule, time: e.target.value } })}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-3" style={{ color: '#8b949e' }}>Days</label>
            <div className="flex gap-2 flex-wrap">
              {ALL_DAYS.map((day) => {
                const active = schedule.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className="px-4 py-2 rounded-md text-xs font-semibold transition-all"
                    style={{
                      border: `1px solid ${active ? '#2563eb' : '#30363d'}`,
                      background: active ? 'rgba(37,99,235,0.15)' : '#0d1117',
                      color: active ? '#79c0ff' : '#8b949e',
                      cursor: 'pointer',
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md px-4 py-3 text-xs leading-relaxed" style={{ background: '#0d1117', border: '1px solid #30363d', color: '#484f58' }}>
            A launchd agent will be installed at{' '}
            <code style={{ color: '#79c0ff' }}>~/Library/LaunchAgents/com.jira-time-tracker.daily.plist</code>
          </div>
        </div>

        {/* Config summary */}
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #30363d' }}>
          <div className="px-4 py-3" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
            <span className="text-xs font-semibold" style={{ color: '#8b949e' }}>Configuration Summary</span>
          </div>
          {summaryRows.map((row, i) => (
            <div
              key={row.label}
              className="flex px-4 py-2.5"
              style={{
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                borderTop: '1px solid #30363d',
              }}
            >
              <span className="text-xs w-40 flex-shrink-0" style={{ color: '#8b949e' }}>{row.label}</span>
              <span className="text-xs font-mono" style={{ color: '#e6edf3' }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving || saved || !canSave}>
            {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Configuration'}
          </button>
          {saved && (
            <span className="text-xs" style={{ color: '#56d364' }}>
              Config written to ~/.jira-time-tracker/config.json
            </span>
          )}
          {saveError && (
            <span className="text-xs" style={{ color: '#f85149' }}>{saveError}</span>
          )}
        </div>
      </div>
    </PageShell>
  );
}
