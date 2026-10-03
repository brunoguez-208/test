import type { ReactNode } from "react";

/** Fila de opción: título, descripción opcional y control a la derecha o debajo. */
export function Field({ label, hint, children, inline, aside, testId }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean; aside?: ReactNode; testId?: string }) {
  if (inline) {
    return (
      <div className="setting-row flex items-center justify-between gap-4 rounded-[6px] px-3.5 py-2.5" data-testid={testId}>
        <div className="min-w-0">
          <p className="t-body">{label}</p>
          {hint && <p className="t-caption text-[var(--text-secondary)]">{hint}</p>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="t-body-strong">{label}</span>
        {aside}
      </div>
      {children}
      {hint && <p className="t-caption text-[var(--text-secondary)]">{hint}</p>}
    </div>
  );
}

export function Section({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      {title && <h3 className="t-caption uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{title}</h3>}
      {children}
    </section>
  );
}

/** Estado vacío del inspector. */
export function Empty({ icon, title, body }: { icon: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="empty-icon mb-1 flex h-12 w-12 items-center justify-center rounded-full text-[22px]">{icon}</span>
      <p className="t-body-strong">{title}</p>
      <p className="t-caption max-w-[240px] text-[var(--text-secondary)]">{body}</p>
    </div>
  );
}

export function fmtNum(v: number, digits = 1): string {
  return v.toFixed(digits).replace(".", ",");
}
