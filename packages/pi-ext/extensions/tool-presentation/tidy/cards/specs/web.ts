import { CYAN } from "../../render.js";
import { compactNumber, count, detailsError, joinFacts, rawExpanded, resultText, shortUrl, type CardSpec } from "../spec.js";
const queries = (a: any): string[] => a.queries ?? (a.query ? [a.query] : []);
const urls = (a: any): string[] => a.urls ?? (a.url ? [a.url] : []);
const base = { color: CYAN, failed: detailsError, expanded: rawExpanded };
export const webSpecs: Record<string, CardSpec> = {
  web_search: { ...base, icon: "󰖟", label: "search", headline: (a) => `search ${queries(a)[0] ?? "web"}`,
    target: (a) => queries(a).length ? `"${queries(a)[0]}"${queries(a).length > 1 ? ` +${queries(a).length - 1}` : ""}` : "",
    running: (r) => joinFacts(r.details?.phase ?? "searching", typeof r.details?.progress === "string" ? r.details.progress : ""),
    summary: (r) => joinFacts(r.details?.queryCount !== undefined ? `${r.details.successfulQueries}/${r.details.queryCount} queries` : "", count(r.details?.totalResults, "sources"), r.details?.curated ? "curated" : "") },
  fetch_content: { ...base, icon: "󰅢", label: "fetch", headline: (a) => a.mode === "answer" && a.prompt ? a.prompt : `fetch ${urls(a).length > 1 ? `${urls(a).length} URLs` : shortUrl(urls(a)[0])}`,
    target: (a) => urls(a).length > 1 ? `${urls(a).length} URLs` : shortUrl(urls(a)[0]),
    summary: (r) => joinFacts(r.details?.urlCount > 1 ? `${r.details.successful}/${r.details.urlCount} fetched` : "", typeof r.details?.totalChars === "number" ? `${compactNumber(r.details.totalChars)} chars` : "", r.details?.responseId ? "stored" : "", r.details?.imageCount ? `${r.details.imageCount} images` : "", r.details?.duration) },
  get_search_content: { ...base, icon: "󰺮", label: "stored", headline: (a) => a.findText ? `find "${Array.isArray(a.findText) ? a.findText.join(', ') : a.findText}"` : "read stored result",
    target: (a) => joinFacts(String(a.responseId ?? "").slice(0, 6), a.query ?? a.url ?? (a.urlIndex !== undefined ? `url ${a.urlIndex}` : a.queryIndex !== undefined ? `query ${a.queryIndex}` : "")),
    summary: (r) => r.details?.matchCount !== undefined ? `${r.details.matchCount} matches` : joinFacts(typeof r.details?.contentLength === "number" ? `${compactNumber(r.details.returnedChars ?? resultText(r).length)} of ${compactNumber(r.details.contentLength)} chars` : "", r.details?.truncated ? "more" : "") },
  source_check: { ...base, icon: "󰞑", label: "sources", headline: (a) => a.claim, target: (a) => a.queries?.length ? `${a.queries.length} queries` : "",
    summary: (r) => joinFacts(count(r.details?.sourceCount, "sources"), count(r.details?.passageCount, "passages"), r.details?.artifact?.errors?.length ? `${r.details.artifact.errors.length} failed` : ""),
    expanded: (r) => (r.details?.artifact?.sources ?? []).flatMap((s: any, i: number) => [`${i + 1}. ${s.title} · ${shortUrl(s.url)}`, r.details?.artifact?.passages?.find((p: any) => p.source_url === s.url)?.text ?? s.snippet ?? ""]) },
};
