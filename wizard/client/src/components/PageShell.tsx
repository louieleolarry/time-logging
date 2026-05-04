import { type ReactNode } from 'react';

interface PageShellProps {
  badge?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export default function PageShell({ badge, title, subtitle, children, footer }: PageShellProps) {
  return (
    <div className="flex flex-col h-full px-10 py-8">
      <div className="mb-6">
        {badge && (
          <span className="badge badge-blue mb-3 inline-block">{badge}</span>
        )}
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#e6edf3', letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm leading-relaxed" style={{ color: '#8b949e', maxWidth: 560 }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {footer && (
        <div className="mt-6 flex items-center justify-between pt-4" style={{ borderTop: '1px solid #30363d' }}>
          {footer}
        </div>
      )}
    </div>
  );
}
