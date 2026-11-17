chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CHECK_APPLIED_PROTOCOLS") {
    const protocols = Array.isArray(message.protocols) ? message.protocols : [];

    fetchAppliedProtocols()
      .then(({ appliedIds, raw }) => {
        console.log("ModMed protocols response:", raw);
        console.log("Parsed protocol-like IDs on visit:", appliedIds);

        const requestedIds = protocols
          .map((p) => String(p.id ?? p).trim())
          .filter(Boolean);

        const matchedIds = requestedIds.filter((id) => responseContainsId(raw, id));
        const missingIds = requestedIds.filter((id) => !matchedIds.includes(id));

        console.log("Requested:", requestedIds, "Matched:", matchedIds, "Missing:", missingIds);

        sendResponse({
          success: true,
          visitId: getActiveVisitId(),
          appliedIds: matchedIds,
          missingIds,
          allAppliedIds: appliedIds
        });
      })
      .catch((err) => {
        console.log("Error checking applied protocols:", err.message);
        sendResponse({ success: false, error: err.message, appliedIds: [], missingIds: [] });
      });

    return true;
  }

  if (message.action === "APPLY_PROTOCOLS") {
    applyProtocolsToVisit(message.protocolIds || [])
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

function getActiveVisitId() {
  if (document.documentElement.dataset.modmedVisitId) {
    return document.documentElement.dataset.modmedVisitId;
  }

  const urlMatch = window.location.href.match(/visits\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  return null;
}

function getXsrfToken() {
  const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function authHeaders(extra = {}) {
  const xsrf = getXsrfToken();
  return {
    Accept: "application/json, text/plain, */*",
    ...extra,
    ...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {})
  };
}

function responseContainsId(raw, id) {
  const needle = String(id).trim();
  if (!/^\d+$/.test(needle)) return false;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return new RegExp(`(^|[^0-9])${needle}([^0-9]|$)`).test(text);
}

function collectProtocolIds(value, out = new Set(), seen = new Set()) {
  if (value == null) return out;

  if (typeof value === "number" || typeof value === "string") {
    const id = String(value).trim();
    if (/^\d+$/.test(id)) out.add(id);
    return out;
  }

  if (typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectProtocolIds(item, out, seen));
    return out;
  }

  const idKeys = new Set([
    "id",
    "protocolId",
    "protocolDefinitionId",
    "masterVisitId",
    "orderProtocolId"
  ]);

  for (const [key, child] of Object.entries(value)) {
    if (idKeys.has(key) && (typeof child === "number" || typeof child === "string")) {
      const id = String(child).trim();
      if (/^\d+$/.test(id)) out.add(id);
      continue;
    }

    if (
      child != null &&
      typeof child === "object" &&
      !/cookie|header|html|token/i.test(key)
    ) {
      collectProtocolIds(child, out, seen);
    }
  }

  return out;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API returned ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return res.json();
}

async function fetchAppliedProtocols() {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Open a visit note or refresh the ModMed page.");
  }

  const endpoints = [
    `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}/protocols?orderVersion=0&selector=ordersSent,hasSendableLabOrderRequest`,
    `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}/protocols`,
    `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}?selector=protocols`
  ];

  let lastError = null;
  let raw = null;

  for (const url of endpoints) {
    try {
      raw = await fetchJson(url);
      const appliedIds = [...collectProtocolIds(raw)];
      // Prefer the first endpoint that succeeds; even empty is valid (none applied).
      return { appliedIds, raw, url };
    } catch (err) {
      lastError = err;
      console.log(`Protocol fetch failed for ${url}:`, err.message);
    }
  }

  throw lastError || new Error("Could not load applied protocols.");
}

async function applyProtocolsToVisit(protocolIds) {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Try clicking into the visit note or refreshing the page.");
  }

  const ids = (protocolIds || []).map((id) => String(id).trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("No protocol IDs provided.");
  }

  const url =
    `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}/protocols` +
    `?orderVersion=0&selector=ordersSent,hasSendableLabOrderRequest`;

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(ids.map((id) => (/^\d+$/.test(id) ? Number(id) : id)))
  });

  if (!res.ok) throw new Error(`ModMed API returned ${res.status}`);

  window.location.reload();
}
