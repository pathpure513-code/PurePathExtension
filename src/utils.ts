// ------------------------------------------------------------
// DOMAIN / URL NORMALIZATION
// ------------------------------------------------------------
export function normalizeDomain(url: string): string {
  try {
    const u = new URL(url);
    let host = u.hostname.toLowerCase();
    host = host.replace(/^www\./, "");
    return host;
  } catch {
    return "";
  }
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-.]/g, " ")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ------------------------------------------------------------
// URL CLASSIFICATION HELPERS
// ------------------------------------------------------------
export function isBlockPage(url: string): boolean {
  return url.includes("block.html");
}

export function isChromeInternal(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("about:") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("file://")
  );
}

export function isSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      ((h === "www.google.com" || h === "google.com") && u.pathname === "/search") ||
      ((h === "www.bing.com" || h === "bing.com") && u.pathname === "/search")
    );
  } catch {
    return false;
  }
}

export function getSearchQuery(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("google.") || u.hostname.includes("bing.com")) {
      return u.searchParams.get("q") ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

export function splitUrl(url: string): { rootDomain: string; pathQuery: string } | null {
  try {
    const u = new URL(url);
    const rootDomain = normalizeDomain(url);
    const pathQuery = (u.pathname.replace(/^\//, "") + (u.search ?? "")).trim();
    return { rootDomain, pathQuery };
  } catch {
    return null;
  }
}

export function buildBlockUrl(reason: string, originalUrl: string): string {
  return chrome.runtime.getURL(
    `dist/pages/block.html?reason=${encodeURIComponent(reason)}&url=${encodeURIComponent(originalUrl)}`
  );
}