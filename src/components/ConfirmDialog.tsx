import { X } from "lucide-react";
import type { TFunction } from "../i18n";
import { formatCommand } from "../api/skills";

export interface ConfirmDialogState {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  rows: Array<{ label: string; value: string }>;
  args: string[];
  onConfirm: () => Promise<void>;
}

interface ConfirmDialogProps {
  state: ConfirmDialogState | null;
  t: TFunction;
  busy: boolean;
  onClose: () => void;
}

export function ConfirmDialog({ state, t, busy, onClose }: ConfirmDialogProps) {
  if (!state) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal__header">
          <h2 id="confirm-title">{state.title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <div className="confirm-rows">
          {state.rows.map((row) => (
            <div className="confirm-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
        <div className="field-stack">
          <label>{t("common.command")}</label>
          <code className="command-preview">{formatCommand(state.args)}</code>
        </div>
        <div className="field-stack">
          <label>{t("confirm.args")}</label>
          <pre className="code-block code-block--small">{JSON.stringify(state.args, null, 2)}</pre>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`button ${state.danger ? "button--danger" : "button--primary"}`}
            onClick={() => void state.onConfirm()}
            disabled={busy}
          >
            {busy ? t("common.running") : state.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
