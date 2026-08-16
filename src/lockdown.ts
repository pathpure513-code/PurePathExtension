let blockHitsThisWindow = 0;
let currentWindowMinute = -1;
let lockdownUntil = 0;

const LOCKDOWN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const HITS_TO_TRIGGER = 3;

export function isLockedDown(): boolean {
  return Date.now() < lockdownUntil;
}

export async function clearExpiredLockdown(): Promise<void> {
  const now = Date.now();
  if (lockdownUntil && now >= lockdownUntil) {
    lockdownUntil = 0;
    await chrome.storage.local.remove("lockdownUntil");
    console.log("[Web Guardian] 🔓 Lockdown expired");
  }
}

export async function recordBlockHit(): Promise<void> {
  const now = Date.now();
  const thisMinute = Math.floor(now / 60_000);

  if (thisMinute !== currentWindowMinute) {
    currentWindowMinute = thisMinute;
    blockHitsThisWindow = 0;
  }

  blockHitsThisWindow++;
  console.log(`[Web Guardian] 📊 Block hits this minute: ${blockHitsThisWindow}/${HITS_TO_TRIGGER}`);

  if (blockHitsThisWindow >= HITS_TO_TRIGGER) {
    lockdownUntil = now + LOCKDOWN_DURATION_MS;
    await chrome.storage.local.set({ lockdownUntil });
    blockHitsThisWindow = 0;
    currentWindowMinute = -1;
    console.log("[Web Guardian] 🔒 LOCKDOWN MODE TRIGGERED");

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("dist/pages/testing-block.html") });
        }
      }
    });
  }
}

export async function restoreLockdownState(): Promise<void> {
  const result = await chrome.storage.local.get("lockdownUntil");
  if (typeof result.lockdownUntil === "number") {
    lockdownUntil = result.lockdownUntil;
    console.log("[Web Guardian] 🔁 Restored lockdownUntil:", lockdownUntil);
  } else {
    lockdownUntil = 0;
  }
}