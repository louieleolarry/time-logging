interface SidebarProps {
  steps: string[];
  current: number;
}

export default function Sidebar({ steps, current }: SidebarProps) {
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

        return (
          <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-md" style={{
            background: isActive ? 'rgba(37,99,235,0.1)' : 'transparent',
          }}>
            {/* Connector line above (except first) */}
            <div className="flex flex-col items-center" style={{ width: 10 }}>
              <div
                className="step-dot"
                style={{
                  borderColor: isDone ? '#16a34a' : isActive ? '#2563eb' : '#30363d',
                  background: isDone ? '#16a34a' : isActive ? '#2563eb' : 'transparent',
                  boxShadow: isActive ? '0 0 0 3px rgba(37,99,235,0.2)' : 'none',
                }}
              />
            </div>

            <span
              className="text-xs font-medium truncate"
              style={{
                color: isDone ? '#56d364' : isActive ? '#e6edf3' : '#484f58',
              }}
            >
              {isDone ? (
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
