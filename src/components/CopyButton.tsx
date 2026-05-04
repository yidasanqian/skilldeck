import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TFunction } from "../i18n";

type CopyState = "idle" | "copied" | "failed";

interface CopyButtonProps {
  value: string | (() => string);
  label: string;
  t: TFunction;
}

const RESET_DELAY_MS = 1600;

export function CopyButton({ value, label, t }: CopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  function markCopyState(nextState: CopyState) {
    setCopyState(nextState);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimer.current = null;
    }, RESET_DELAY_MS);
  }

  async function copyValue() {
    const text = typeof value === "function" ? value() : value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      markCopyState("copied");
    } catch {
      markCopyState("failed");
    }
  }

  const feedback =
    copyState === "copied" ? t("common.copied") : copyState === "failed" ? t("common.copyFailed") : "";
  const Icon = copyState === "copied" ? Check : copyState === "failed" ? TriangleAlert : Copy;

  return (
    <span className="copy-button-shell">
      <button
        className={`icon-button copy-button copy-button--${copyState}`}
        type="button"
        aria-label={feedback || label}
        title={feedback || label}
        onClick={() => void copyValue()}
      >
        <Icon size={15} />
        <span className="sr-only" aria-live="polite">
          {feedback || label}
        </span>
      </button>
      {feedback ? (
        <span className={`copy-button__feedback copy-button__feedback--${copyState}`} role="status">
          {feedback}
        </span>
      ) : null}
    </span>
  );
}
