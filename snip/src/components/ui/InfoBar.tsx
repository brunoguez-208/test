import type { ReactNode } from "react";
import {
  CheckmarkCircle20Filled,
  Dismiss16Regular,
  ErrorCircle20Filled,
  Info20Filled,
  Warning20Filled,
} from "@fluentui/react-icons";
import type { Severity } from "../../store/editor";

const ICONS: Record<Severity, ReactNode> = {
  info: <Info20Filled />,
  success: <CheckmarkCircle20Filled />,
  caution: <Warning20Filled />,
  critical: <ErrorCircle20Filled />,
};

interface InfoBarProps {
  severity: Severity;
  title: string;
  message?: ReactNode;
  onClose?: () => void;
  action?: ReactNode;
  className?: string;
  testId?: string;
}

/** InfoBar de WinUI: ícono de severidad, título, mensaje y cerrar. */
export function InfoBar({ severity, title, message, onClose, action, className = "", testId }: InfoBarProps) {
  return (
    <div
      role={severity === "critical" || severity === "caution" ? "alert" : "status"}
      data-testid={testId}
      className={`infobar infobar-${severity} flex items-start gap-3 rounded-[8px] py-3 pl-4 pr-2 ${className}`}
    >
      <span className="infobar-icon mt-[1px] flex shrink-0 text-[20px] leading-none">{ICONS[severity]}</span>
      <div className="min-w-0 flex-1 py-[1px]">
        <span className="t-body-strong mr-2">{title}</span>
        {message && <span className="t-body text-[var(--text-secondary)]">{message}</span>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="btn-subtle -my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]"
        >
          <Dismiss16Regular />
        </button>
      )}
    </div>
  );
}
