import { Download, Search as SearchIcon } from "lucide-react";
import { useState } from "react";
import type { SkillsApi } from "../api/skills";
import type { TFunction } from "../i18n";
import type { CommandResult, InstallDraft, SkillSearchResult } from "../types";
import { formatTerminalOutput } from "../utils/terminal";

interface SearchViewProps {
  api: SkillsApi;
  canMutate: boolean;
  t: TFunction;
  onCommand: (command: CommandResult) => void;
  onPrepareInstall: (draft: InstallDraft) => void;
}

function inferSkillName(source: string) {
  return source.split(/[\/@]/).filter(Boolean).at(-1) ?? "";
}

export function SearchView({ api, canMutate, t, onCommand, onPrepareInstall }: SearchViewProps) {
  const [query, setQuery] = useState("frontend design");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [rawOutput, setRawOutput] = useState("");
  const [selected, setSelected] = useState<SkillSearchResult | null>(null);
  const [rawSource, setRawSource] = useState("");

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await api.skillsFind(query.trim());
      setResults(response.results);
      setRawOutput(response.rawOutput);
      setSelected(response.results[0] ?? null);
      onCommand(response.command);
    } finally {
      setLoading(false);
    }
  }

  function prepareSelected(result: SkillSearchResult) {
    setSelected(result);
    onPrepareInstall({ source: result.source, skillNames: [result.name] });
  }

  function prepareRaw() {
    const source = rawSource.trim();
    if (!source) return;
    onPrepareInstall({ source, skillNames: inferSkillName(source) ? [inferSkillName(source)] : [] });
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>{t("search.title")}</h1>
          <p>{t("search.subtitle")}</p>
        </div>
      </section>

      <section className="section-panel">
        <div className="search-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.title")}
          />
          <button className="button button--primary" type="button" onClick={() => void runSearch()} disabled={loading || !query.trim()}>
            <SearchIcon size={15} />
            {loading ? t("common.running") : t("common.search")}
          </button>
        </div>
      </section>

      <section className="section-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("common.skill")}</th>
                <th>{t("common.source")}</th>
                <th>{t("common.description")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id} className={selected?.id === result.id ? "is-selected" : ""}>
                  <td>
                    <strong>{result.name}</strong>
                    <div className="tag-row">{result.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>
                  </td>
                  <td>
                    <code>{result.source}</code>
                  </td>
                  <td>{result.description}</td>
                  <td>
                    <button className="button button--secondary" type="button" onClick={() => prepareSelected(result)} disabled={!canMutate}>
                      <Download size={15} />
                      {t("search.openInstallWizard")}
                    </button>
                  </td>
                </tr>
              ))}
              {results.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state compact">{rawOutput ? t("search.noResults") : t("search.emptyQuery")}</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section-panel">
        <details open={Boolean(rawOutput)}>
          <summary>{t("common.rawOutput")}</summary>
          <pre className="code-block">{formatTerminalOutput(rawOutput, t("common.none"))}</pre>
        </details>
        <div className="raw-install">
          <label className="field-stack">
            {t("search.rawSource")}
            <input value={rawSource} onChange={(event) => setRawSource(event.target.value)} placeholder="org/repo 或 https://github.com/org/repo" />
          </label>
          <button className="button button--secondary" type="button" onClick={prepareRaw} disabled={!canMutate || !rawSource.trim()}>
            {t("search.useRaw")}
          </button>
        </div>
      </section>
    </div>
  );
}
