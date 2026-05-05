import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './components/Sidebar';
import Welcome from './pages/Welcome';
import ChooseSource from './pages/ChooseSource';
import JiraCredentials from './pages/JiraCredentials';
import ChargeCodes from './pages/ChargeCodes';
import InstallDeps from './pages/InstallDeps';
import ParsingRules from './pages/ParsingRules';
import Configure from './pages/Configure';
import TestVerify from './pages/TestVerify';
import SampleNote from './pages/SampleNote';
import Done from './pages/Done';

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
}

export const STEPS = [
  'Welcome',
  'Choose Source',
  'Jira Credentials',
  'Charge Codes',
  'Install Dependencies',
  'Parsing Rules',
  'Configure',
  'Test & Verify',
  'Sample Note',
  'Done',
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
    <ChargeCodes key="codes" update={update} onNext={next} onBack={back} />,
    <InstallDeps key="install" state={state} onNext={next} onBack={back} />,
    <ParsingRules key="parsing" state={state} update={update} onNext={next} onBack={back} />,
    <Configure key="configure" state={state} update={update} onNext={next} onBack={back} />,
    <TestVerify key="verify" state={state} update={update} onNext={next} onBack={back} />,
    <SampleNote key="sample" onNext={next} onBack={back} />,
    <Done key="done" state={state} />,
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
      <Sidebar steps={STEPS} current={step} onNavigate={goTo} />

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
