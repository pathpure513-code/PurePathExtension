import { lookupDomain, blockDomain, listDomains, DomainFilter } from "../src/api";
import { normalizeDomain } from "../src/utils";

function showToast(message: string) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => {
    toast.style.display = "none";
  }, 2500);
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

function renderStatus(el: HTMLElement, filter: DomainFilter | null) {
  if (filter === "BLOCKED") {
    el.innerHTML = `<span class="status-badge status-blocked">🚫 Blocked</span>`;
  } else if (filter === "SAFE") {
    el.innerHTML = `<span class="status-badge status-safe">✅ Permanently safe</span>`;
  } else if (filter === "OKAY") {
    el.innerHTML = `<span class="status-badge status-okay">🟡 Okay (path checked)</span>`;
  } else {
    el.innerHTML = `<span class="status-badge status-unknown">❔ Not tracked yet</span>`;
  }
}

async function loadStats() {
  const [blocked, all] = await Promise.all([listDomains("BLOCKED"), listDomains()]);
  const blockedCountEl = document.getElementById("blocked-count");
  const totalCountEl = document.getElementById("total-count");
  if (blockedCountEl) blockedCountEl.textContent = String(blocked.length);
  if (totalCountEl) totalCountEl.textContent = String(all.length);
}

async function init() {
  const tab = await getCurrentTab();
  const domainEl = document.getElementById("current-domain")!;
  const statusEl = document.getElementById("current-status")!;
  const blockBtn = document.getElementById("btn-block-site") as HTMLButtonElement;

  if (!tab?.url) {
    domainEl.textContent = "No active tab";
    blockBtn.disabled = true;
    blockBtn.className = "btn-disabled";
    loadStats();
    return;
  }

  const domain = normalizeDomain(tab.url);

  if (!domain) {
    domainEl.textContent = "Cannot detect domain";
    blockBtn.disabled = true;
    blockBtn.className = "btn-disabled";
    loadStats();
    return;
  }

  domainEl.textContent = domain;

  let currentFilter: DomainFilter | null = null;
  try {
    currentFilter = await lookupDomain(domain);
    renderStatus(statusEl, currentFilter);
  } catch (err) {
    console.error("[Web Guardian popup] Failed to reach backend:", err);
    statusEl.innerHTML = `<span class="status-badge status-unknown">⚠️ Can't reach backend</span>`;
    // Don't return here — still let the person attempt a block below,
    // and still attach the listener so the button isn't dead.
  }

  if (currentFilter === "BLOCKED") {
    blockBtn.disabled = true;
    blockBtn.className = "btn-disabled";
    blockBtn.textContent = "Already blocked";
  } else if (currentFilter === "SAFE") {
    blockBtn.disabled = true;
    blockBtn.className = "btn-disabled";
    blockBtn.textContent = "Permanently safe — can't block here";
  }

  blockBtn.addEventListener("click", async () => {
    const confirmed = confirm(`Block "${domain}"?\n\nThis will mark it BLOCKED going forward.`);
    if (!confirmed) return;

    try {
      await blockDomain(domain);
      renderStatus(statusEl, "BLOCKED");
      blockBtn.disabled = true;
      blockBtn.className = "btn-disabled";
      blockBtn.textContent = "Already blocked";
      showToast(`"${domain}" has been blocked`);
      await loadStats();

      if (tab.id) {
        const blockUrl = chrome.runtime.getURL(
          `dist/pages/block.html?reason=${encodeURIComponent("Manually blocked via Web Guardian")}&url=${encodeURIComponent(tab.url!)}`
        );
        chrome.tabs.update(tab.id, { url: blockUrl });
      }
    } catch (err) {
      console.error("[Web Guardian popup] Failed to block domain:", err);
      showToast("Failed to block — check backend connection");
    }
  });

  try {
    await loadStats();
  } catch (err) {
    console.error("[Web Guardian popup] Failed to load stats:", err);
  }
}

init();