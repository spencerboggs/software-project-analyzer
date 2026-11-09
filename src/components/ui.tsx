import type { ReactNode } from 'react';

export function Section({
  index,
  title,
  aside,
  children,
}: {
  index: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <header className="section-head">
        <span className="section-index">{index}</span>
        <h2>{title}</h2>
        {aside ? <span className="section-aside">{aside}</span> : null}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Meter({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  const filled = Math.round(clamped / 5);
  return (
    <div className="meter" role="img" aria-label={`${clamped} out of 100`}>
      {Array.from({ length: 20 }, (_, index) => (
        <span key={index} className={index < filled ? 'on' : undefined} />
      ))}
    </div>
  );
}

export function TaskStrip({
  task,
}: {
  task: { kind: string; label: string; received?: number };
}) {
  return (
    <div className="taskbar" role="status" aria-live="polite">
      <span className="taskbar-mark" aria-hidden="true" />
      <span className="taskbar-label">{task.label}</span>
      <span className="taskbar-meta">
        {task.received ? `${task.received.toLocaleString()} chars` : task.kind}
      </span>
      <span className="taskbar-track" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}

export function NoticeBar({
  notice,
  onClose,
}: {
  notice: { kind: 'info' | 'error'; text: string };
  onClose: () => void;
}) {
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-mark" aria-hidden="true">
        {notice.kind === 'error' ? '!' : 'i'}
      </span>
      <p>{notice.text}</p>
      <button type="button" className="icon-btn notice-close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function FieldLabel({
  text,
  hint,
  optional,
}: {
  text: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <span className="label">
      {text}
      {optional ? <b className="optional">OPTIONAL</b> : null}
      {hint ? <em>{hint}</em> : null}
    </span>
  );
}
