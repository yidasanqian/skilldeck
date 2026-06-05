import { useMemo } from "react";
import { X } from "lucide-react";
import { marked } from "marked";
import type { TFunction } from "../i18n";

export interface SkillPreviewState {
  skillName: string;
  content: string | null;
  loading: boolean;
  error?: string;
}

interface SkillPreviewDialogProps {
  state: SkillPreviewState | null;
  t: TFunction;
  onClose: () => void;
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

export function SkillPreviewDialog({ state, t, onClose }: SkillPreviewDialogProps) {
  const html = useMemo(() => {
    if (!state?.content) return "";
    return marked.parse(stripFrontmatter(state.content)) as string;
  }, [state?.content]);

  if (!state) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="preview-title">
            {t("installed.previewTitle")} · <code>{state.skillName}</code>
          </h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <div className="preview-content">
          {state.loading ? (
            <div className="preview-loading">{t("installed.previewLoading")}</div>
          ) : state.error ? (
            <div className="notice notice--warning">{t("installed.previewError")}: {state.error}</div>
          ) : (
            // 内容来自本地受信任文件，非外部用户输入
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </section>
    </div>
  );
}
