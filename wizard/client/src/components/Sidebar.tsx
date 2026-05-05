interface SidebarProps {
  steps: string[];
  current: number;
  onNavigate?: (index: number) => void;
  stepStatus?: Record<number, 'success' | 'error'>;
}

export default function Sidebar({ steps, current, onNavigate, stepStatus = {} }: SidebarProps) {
  return (
    <div
      className="flex flex-col py-8 px-5 gap-1"
      style={{ width: 200, background: '#0d1117', borderRight: '1px solid #30363d', flexShrink: 0 }}
    >
      <div className="mb-6 px-2">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: '#484f58' }}>
          Setup Wizard
        </span>
      </div>

      {steps.map((label, i) => {
        const isDone = i < current;
        const isActive = i === current;
        const status = stepStatus[i]; // 'success' | 'error' | undefined
        // A step that is 'done' (passed) but has an error status shows red
        const isSuccess = isDone || status === 'success';
        const isError = status === 'error';
        const dotColor = isActive ? '#2563eb'
          : isError ? '#f85149'
          : isSuccess ? '#16a34a'
          : '#30363d';
        const dotBg = isActive ? '#2563eb'
          : isError ? '#f85149'
          : isSuccess ? '#16a34a'
          : 'transparent';
        const labelColor = isActive ? '#e6edf3'
          : isError ? '#f85149'
          : isSuccess ? '#56d364'
          : '#484f58';

        return (
          <div
            key={i}
            onClick={() => onNavigate?.(i)}
            className="flex items-center gap-3 px-2 py-2 rounded-md transition-colors"
            style={{
              background: isActive ? 'rgba(37,99,235,0.1)' : 'transparent',
              cursor: onNavigate ? 'pointer' : 'default',
            }}
            title={onNavigate ? `Go to ${label}` : undefined}
            onMouseEnter={(e) => {
              if (onNavigate && !isActive) {
                (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }
            }}
          >
            {/* Step dot */}
            <div className="flex flex-col items-center" style={{ width: 10 }}>
            <div
              className="step-dot"
              style={{
                borderColor: dotColor,
                background: dotBg,
                boxShadow: isActive ? '0 0 0 3px rgba(37,99,235,0.2)' : 'none',
              }}
            />
            </div>

            <span
              className="text-xs font-medium truncate"
              style={{ color: labelColor }}
            >
              {isError ? (
                <span className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2l8 8M10 2l-8 8" stroke="#f85149" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  {label}
                </span>
              ) : isSuccess ? (
                <span className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="#56d364" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {label}
                </span>
              ) : label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
