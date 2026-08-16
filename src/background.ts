import { matchesKeywordSmart } from "./keywords";
import {
  lookupDomain,
  classifySearchQuery,
  classifyWebsite,
  parseURL,
  classifyYoutube,
  checkAIServerHealth,
  addDomain,
} from "./api";
import {
  isBlockPage,
  isChromeInternal,
  isSearchUrl,
  getSearchQuery,
  splitUrl,
  buildBlockUrl,
} from "./utils";
import {
  isLockedDown,
  clearExpiredLockdown,
  recordBlockHit,
  restoreLockdownState,
} from "./lockdown";

const inFlightSearches = new Set<string>();
const inFlightDomains = new Set<string>();
const inFlightPaths = new Set<string>();

// ------------------------------------------------------------
// REDIRECT DEDUP
// ------------------------------------------------------------
const recentlyBlocked = new Map<number, { url: string; ts: number }>();
const RECENT_BLOCK_MS = 3000;

async function redirectOnce(tabId: number, targetUrl: string): Promise<boolean> {
  const now = Date.now();
  const prev = recentlyBlocked.get(tabId);
  if (prev && prev.url === targetUrl && now - prev.ts < RECENT_BLOCK_MS) return false;
  recentlyBlocked.set(tabId, { url: targetUrl, ts: now });
  chrome.tabs.update(tabId, { url: targetUrl });
  return true;
}

// ------------------------------------------------------------
// MAIN HANDLER
// ------------------------------------------------------------
async function handleMainFrameUrl(tabId: number, url: string) {
  await clearExpiredLockdown();

  if (isLockedDown()) {
    console.log("[Web Guardian] 🔒 In LOCKDOWN MODE");
    await redirectOnce(tabId, chrome.runtime.getURL("dist/pages/testing-block.html"));
    return;
  }

  if (isBlockPage(url) || isChromeInternal(url)) return;

  // ── SEARCH PAGES ──────────────────────────────────────────
  if (isSearchUrl(url)) {
    const query = getSearchQuery(url);

    const kwMatch = matchesKeywordSmart(query);
    if (kwMatch) {
      console.log(`[Web Guardian] 🚫 Search blocked — keyword: "${kwMatch}"`);
      const didRedirect = await redirectOnce(tabId, buildBlockUrl(`Search matched keyword: ${kwMatch}`, url));
      if (didRedirect) await recordBlockHit();
      return;
    }

    const flightKey = `${tabId}:${query}`;
    if (inFlightSearches.has(flightKey)) return;
    inFlightSearches.add(flightKey);

    try {
      const aiResult = await classifySearchQuery(query);
      if (aiResult === "BLOCK") {
        const didRedirect = await redirectOnce(tabId, buildBlockUrl("AI blocked search", url));
        if (didRedirect) await recordBlockHit();
      }
    } finally {
      inFlightSearches.delete(flightKey);
    }
    return;
  }

  // ── WEBSITE VISIT ─────────────────────────────────────────
  const split = splitUrl(url);
  if (!split) return;
  const { rootDomain, pathQuery } = split;

  const flightKey = `${tabId}:${rootDomain}`;
  if (inFlightDomains.has(flightKey)) return;
  inFlightDomains.add(flightKey);

  let filter: "BLOCKED" | "SAFE" | "OKAY" | null;
  try {
    filter = await lookupDomain(rootDomain);

    if (filter === null) {
      // Unknown domain — ask the AI, then persist the result so next time it's a lookup, not an AI call.
      filter = await classifyWebsite(rootDomain, url, undefined);
      await addDomain(rootDomain, filter);
      console.log(`[Web Guardian] 🧠 ${rootDomain} — AI classified as ${filter}, saved`);
    }
  } finally {
    inFlightDomains.delete(flightKey);
  }

  if (filter === "BLOCKED") {
    console.log(`[Web Guardian] 🚫 ${rootDomain} — BLOCKED`);
    const didRedirect = await redirectOnce(tabId, buildBlockUrl("Domain is blocked", url));
    if (didRedirect) await recordBlockHit();
    return;
  }

  if (filter === "SAFE") {
    console.log(`[Web Guardian] ✅ ${rootDomain} — SAFE (permanent), skipping path check`);
    return;
  }

  // filter === "OKAY" — domain-level is fine, but still check the path/query
  if (pathQuery && !(rootDomain === "youtube.com" && pathQuery.includes("watch?v="))) {
    // Cheap, instant local keyword check before ever hitting the AI.
    const kwMatch = matchesKeywordSmart(pathQuery);
    if (kwMatch) {
      console.log(`[Web Guardian] 🚫 ${rootDomain} — path matched keyword: "${kwMatch}"`);
      const didRedirect = await redirectOnce(tabId, buildBlockUrl(`Path matched keyword: ${kwMatch}`, url));
      if (didRedirect) await recordBlockHit();
      return;
    }

    const pathFlightKey = `${tabId}:${rootDomain}:${pathQuery}`;
    if (!inFlightPaths.has(pathFlightKey)) {
      inFlightPaths.add(pathFlightKey);
      try {
        const pathResult = await parseURL(pathQuery, rootDomain);
        if (pathResult?.classification === "BLOCK") {
          console.log(`[Web Guardian] 🚫 ${rootDomain} — path/query blocked`);
          const didRedirect = await redirectOnce(tabId, buildBlockUrl("AI blocked URL path content", url));
          if (didRedirect) await recordBlockHit();
          return;
        }
      } finally {
        inFlightPaths.delete(pathFlightKey);
      }
    }
  }

  // YouTube watch pages: backend handles video ID extraction, channel safelist,
  // and age-restriction lookup entirely from the URL — no title needed here.
  if (rootDomain.includes("youtube.com") && pathQuery.includes("watch")) {
    const ytResult = await classifyYoutube(url);
    if (ytResult === "BLOCK") {
      console.log(`[Web Guardian] 🚫 YouTube video blocked`);
      const didRedirect = await redirectOnce(tabId, buildBlockUrl("YouTube video restricted", url));
      if (didRedirect) await recordBlockHit();
    }
  }
}

// ------------------------------------------------------------
// EVENT LISTENERS
// ------------------------------------------------------------
function shouldHandle(details: chrome.webNavigation.WebNavigationBaseCallbackDetails): boolean {
  return details.frameId === 0 && details.tabId !== -1 && typeof details.url === "string";
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (shouldHandle(d)) handleMainFrameUrl(d.tabId, d.url!);
});
chrome.webNavigation.onCommitted.addListener((d) => {
  if (shouldHandle(d)) handleMainFrameUrl(d.tabId, d.url!);
});
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (!shouldHandle(d)) return;
  // Small delay + re-fetch: on heavy SPAs (YouTube especially), the URL in
  // the event payload can occasionally lag the real, current tab URL.
  await new Promise((r) => setTimeout(r, 150));
  try {
    const tab = await chrome.tabs.get(d.tabId);
    if (tab.url) handleMainFrameUrl(d.tabId, tab.url);
  } catch {
    // tab may have closed in the meantime — ignore
  }
});

// Backup signal: catches SPA-style URL changes (like YouTube's own search box)
// that onHistoryStateUpdated sometimes misses entirely.
const lastCheckedUrl = new Map<number, string>();
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  if (lastCheckedUrl.get(tabId) === changeInfo.url) return; // avoid double-checking the same URL
  lastCheckedUrl.set(tabId, changeInfo.url);
  handleMainFrameUrl(tabId, changeInfo.url);
});

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
checkAIServerHealth().then((ok) =>
  console.log(ok ? "[Web Guardian] ✅ Backend connected" : "[Web Guardian] ⚠️ Backend offline")
);
restoreLockdownState();

// cleanup old redirect-dedup entries
setInterval(() => {
  const now = Date.now();
  for (const [tabId, entry] of recentlyBlocked) {
    if (now - entry.ts > 30_000) recentlyBlocked.delete(tabId);
  }
}, 30_000);

// cleanup stale lastCheckedUrl entries for tabs that no longer exist
chrome.tabs.onRemoved.addListener((tabId) => {
  lastCheckedUrl.delete(tabId);
});