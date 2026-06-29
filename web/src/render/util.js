// Low-level view helpers: HTML escaping, id/url encoding, the markdown renderer, and the asset
// version. No DOM, no DB — pure string → string. Shared by every component / page / the layout.
import MarkdownIt from "markdown-it";
import mk from "@vscode/markdown-it-katex";

const md = new MarkdownIt({ html: false, linkify: true });
md.use(mk.default || mk); // server-side KaTeX: $…$ / $$…$$ → KaTeX HTML (parsed before markdown, so x_1 is safe;
//                            the page just needs /katex/katex.min.css + its self-hosted fonts to display).
export { md };
export const mdHtml = (s) => md.render(s || ""); // for the JSON API (inject.js discussion)

// bump on any /app.js or /style.css change → ?v= busts the browser cache (dashboard pages are
// no-store, so a normal reload picks up the new version — no hard refresh needed).
export const ASSET_V = "44";

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
// record/figure ids contain "/" and ":" — keep "/" literal (Apache routes it), encode the rest.
export const rid = (id) => encodeURIComponent(id).replace(/%2F/gi, "/");
export const snipHtml = (s) =>
  esc(s).replaceAll("", "<mark>").replaceAll("", "</mark>");
export const stars = (n) => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));
export const isBk = (set, kind, id) => set && set.has(kind + ":" + id);
export const figUrl = (p) => (/^https?:|^\//.test(p) ? p : "/" + p); // content-store-relative → /figures/…

// A figure preview. PDF can't render in <img> (the file is there but the browser shows a broken
// image), so embed it in a NON-interactive <iframe> = the browser's PDF viewer shows the figure;
// raster (svg/png/gif) stays an <img>. `pointer-events:none` (CSS) lets a wrapping <a> take the click.
export const figMedia = (p, alt = "", cls = "") =>
  /\.pdf($|[?#])/i.test(p || "")
    ? `<iframe loading="lazy" class="pdfthumb ${cls}" src="${esc(figUrl(p))}#toolbar=0&navpanes=0&view=FitH" title="${esc(alt)}"></iframe>`
    : `<img loading="lazy" class="${cls}" src="${esc(figUrl(p))}" alt="${esc(alt)}">`;

// A figure's link target. In a MULTI-PAGE Pinax doc the figure lives on a SUB-PAGE (not the record's
// index/cards page), so /r/<record> would land on the cards and never show the figure. The section
// figure id is "<page>_s_fig<n>" → the sub-page file is "<page>.html"; link straight there, centred via
// #arxfig (annot.js focuses it). Single-page docs (no "_s_fig" id) fall back to /r/<record>.
export const figHref = (recordId, figSuffix) => {
  const m = /^(.+)_s_fig\d+$/.exec(figSuffix || "");
  if (m) {
    const safe = String(recordId).replace(/[^A-Za-z0-9_-]/g, "_");
    return `/pages/${safe}/${m[1]}.html#arxfig=${encodeURIComponent(figSuffix)}`;
  }
  return `/r/${rid(recordId)}#arxfig=${encodeURIComponent(figSuffix)}`;
};
