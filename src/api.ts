import { API_BASE_URL, API_AUTH_TOKEN } from "./config";

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

function authedJsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_AUTH_TOKEN}`,
  };
}

async function parseOrThrow(res: Response, context: string): Promise<any> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // response wasn't JSON at all — still fall through to the status check below
  }

  if (!res.ok) {
    const message = data?.error || `${context} failed with status ${res.status}`;
    throw new Error(message);
  }

  return data;
}

// ------------------------------------------------------------
// DOMAIN FILTER LOOKUP / WRITE (single `domains` table, filter enum)
// ------------------------------------------------------------
export type DomainFilter = "BLOCKED" | "SAFE" | "OKAY";

// Reads are still unauthenticated — only writes need the token now.
export async function lookupDomain(domain: string): Promise<DomainFilter | null> {
  const res = await fetch(`${API_BASE_URL}/domains/lookup?domain=${encodeURIComponent(domain)}`, {
    headers: jsonHeaders(),
  });
  const data = await parseOrThrow(res, "Domain lookup");
  return data.found ? data.filter : null;
}

export async function listDomains(filter?: DomainFilter): Promise<{ domain: string; filter: DomainFilter }[]> {
  const query = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  const res = await fetch(`${API_BASE_URL}/domains${query}`, {
    headers: jsonHeaders(),
  });
  const data = await parseOrThrow(res, "List domains");
  return data.domains ?? [];
}

// All writes now require the token, regardless of filter value.
export async function addDomain(
  domain: string,
  filter: DomainFilter
): Promise<{ added: boolean; filter: DomainFilter }> {
  const res = await fetch(`${API_BASE_URL}/domains`, {
    method: "POST",
    headers: authedJsonHeaders(),
    body: JSON.stringify({ domain, filter }),
  });
  const data = await parseOrThrow(res, "Add domain");
  return { added: data.added, filter: data.filter };
}

export async function updateDomainFilter(domain: string, filter: DomainFilter): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/domains`, {
    method: "PATCH",
    headers: authedJsonHeaders(),
    body: JSON.stringify({ domain, filter }),
  });
  await parseOrThrow(res, "Update domain filter");
}

// The actual "block this site" operation the popup uses. Handles both cases:
// domain is brand new (adds it as BLOCKED), or domain already exists with a
// different filter (backend returns 409 for that — catch it and PATCH instead).
export async function blockDomain(domain: string): Promise<void> {
  try {
    await addDomain(domain, "BLOCKED");
  } catch (err) {
    // Domain already exists — fall through to updating its filter instead.
    // (If this throws too, e.g. a real network error, let it propagate up.)
    await updateDomainFilter(domain, "BLOCKED");
  }
}

// ------------------------------------------------------------
// AI CLASSIFICATION ENDPOINTS (unauthenticated — extension needs to call
// these constantly and freely as you browse)
// ------------------------------------------------------------
export async function classifySearchQuery(query: string): Promise<"SAFE" | "BLOCK"> {
  const res = await fetch(`${API_BASE_URL}/classify-search`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ query }),
  });
  const data = await parseOrThrow(res, "Classify search");
  return data.classification ?? "SAFE";
}

// The AI only ever returns "SAFE" or "BLOCK" — never "OKAY" (that's a DB filter
// name, not an AI verdict). This function does the translation right here:
// AI "SAFE"  → DB filter "OKAY"    (still gets path/query checked every visit)
// AI "BLOCK" → DB filter "BLOCKED"
export async function classifyWebsite(
  domain: string,
  url: string,
  title?: string
): Promise<"OKAY" | "BLOCKED"> {
  const res = await fetch(`${API_BASE_URL}/classify-website`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ domain, url, title }),
  });
  const data = await parseOrThrow(res, "Classify website");
  const aiVerdict: "SAFE" | "BLOCK" = data.classification ?? "SAFE";
  return aiVerdict === "BLOCK" ? "BLOCKED" : "OKAY";
}

export async function parseURL(pathQuery: string, domain?: string, title?: string) {
  const res = await fetch(`${API_BASE_URL}/parse-url`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ domain, title, pathQuery }),
  });
  return parseOrThrow(res, "Parse URL"); // { classification: "SAFE" | "BLOCK" }
}

export async function classifyYoutube(url: string): Promise<"SAFE" | "BLOCK"> {
  const res = await fetch(`${API_BASE_URL}/classify-youtube`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ url }),
  });
  const data = await parseOrThrow(res, "Classify YouTube");
  return data.classification ?? "BLOCK";
}

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------
export async function checkAIServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}