import { ChevronDown, ChevronUp, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "../i18n";
import type { CommandResult } from "../types";
import { formatCommand } from "../api/skills";
import { formatTerminalOutput } from "../utils/terminal";
import { CopyButton } from "./CopyButton";
import { StatusChip } from "./StatusChip";

export type LogFilter = "all" | "success" | "failed" | "add" | "remove" | "update" | "find" | "list";

export interface CommandLogFocus {
  commandId: string;
  filter: LogFilter;
}

interface CommandLogProps {
  commands: CommandResult[];
  open: boolean;
  focus: CommandLogFocus | null;
  t: TFunction;
  onToggle: () => void;
}

const filterKeys: Array<{ id: LogFilter; label: Parameters<TFunction>[0] }> = [
  { id: "all", label: "log.filters.all" },
  { id: "success", label: "log.filters.success" },
  { id: "failed", label: "log.filters.failed" },
  { id: "add", label: "log.filters.add" },
  { id: "remove", label: "log.filters.remove" },
  { id: "update", label: "log.filters.update" },
  { id: "find", label: "log.filters.find" },
  { id: "list", label: "log.filters.list" },
];

function commandMatches(command: CommandResult, filter: LogFilter) {
  if (filter === "all") return true;
  if (filter === "success" || filter === "failed") return command.status === filter;
  return command.args.includes(filter);
}

export function CommandLog({ commands, open, focus, t, onToggle }: CommandLogProps) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const filtered = useMemo(
    () => commands.filter((command) => commandMatches(command, filter)),
    [commands, filter],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = commands[0];
  const selected = filtered.find((command) => command.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!focus) return;
    setFilter(focus.filter);
    setSelectedId(focus.commandId);
  }, [focus]);

  return (
    <section className={`command-log ${open ? "is-open" : ""}`}>
      <button className="command-log__summary" type="button" onClick={onToggle}>
        <span>
          <TerminalSquare size={15} />
          <strong>{t("log.title")}</strong>
          {latest ? (
            <span className="muted">
              {t("log.latest")}: {latest.args.slice(0, 3).join(" ")}
            </span>
          ) : (
            <span className="muted">{t("log.empty")}</span>
          )}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open ? (
        <div className="command-log__body">
          <div className="filter-row" role="toolbar" aria-label={t("log.title")}>
            {filterKeys.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip-button ${filter === item.id ? "is-active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="empty-state compact">{t("log.empty")}</div>
          ) : (
            <div className="command-log__grid">
              <div className="command-list">
                {filtered.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className={`command-list__item ${selected?.id === command.id ? "is-active" : ""}`}
                    onClick={() => setSelectedId(command.id)}
                  >
                    <StatusChip value={command.status} label={command.status} />
                    <span>{command.args.slice(0, 3).join(" ")}</span>
                    <small>{command.durationMs ? `${command.durationMs}ms` : ""}</small>
                  </button>
                ))}
              </div>
              {selected ? (
                <div className="command-detail">
                  <div className="command-detail__head">
                    <code>{formatCommand(selected.args)}</code>
                    <CopyButton t={t} label={t("installed.copyCommand")} value={() => formatCommand(selected.args)} />
                  </div>
                  <div className="kv-grid">
                    <span>{t("common.exitCode")}</span>
                    <strong>{selected.exitCode ?? t("common.none")}</strong>
                    <span>{t("common.duration")}</span>
                    <strong>{selected.durationMs ? `${selected.durationMs}ms` : t("common.none")}</strong>
                  </div>
                  <div className="output-grid">
                    <div>
                      <div className="output-grid__head">
                        <label>{t("common.stdout")}</label>
                        <CopyButton t={t} label={t("log.copyStdout")} value={() => selected.stdout} />
                      </div>
                      <pre className="code-block">{formatTerminalOutput(selected.stdout, t("common.none"))}</pre>
                    </div>
                    <div>
                      <div className="output-grid__head">
                        <label>{t("common.stderr")}</label>
                        <CopyButton t={t} label={t("log.copyStderr")} value={() => selected.stderr} />
                      </div>
                      <pre className="code-block">{formatTerminalOutput(selected.stderr, t("common.none"))}</pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
