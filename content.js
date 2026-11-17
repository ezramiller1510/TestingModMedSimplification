const CAPTURE_KEY = "modmedNetCapture";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CHECK_APPLIED_PROTOCOLS") {
    const protocols = Array.isArray(message.protocols) ? message.protocols : [];
    const requestedIds = protocols
      .map((p) => String(p.id ?? p).trim())
      .filter(Boolean);

    discoverWhereIdsAppear(requestedIds)
      .then((result) => {
        console.log("ModMed discovery result:", result);
        sendResponse({ success: true, ...result });
      })
      .catch((err) => {
        console.log("Error checking applied protocols:", err.message);
        sendResponse({
          success: false,
          error: err.message,
          appliedIds: [],
          missingIds: requestedIds,
          hits: []
        });
      });

    return true;
  }

  if (message.action === "GET_CAPTURE_SUMMARY") {
    const log = readCaptureLog();
    sendResponse({
      success: true,
      count: log.length,
      recent: log.slice(-8).map(summarizeCaptureEntry)
    });
    return false;
  }

  if (message.action === "CLEAR_CAPTURE") {
    try {
      sessionStorage.removeItem(CAPTURE_KEY);
      document.documentElement.dataset.modmedCaptureCount = "0";
    } catch {}
    sendResponse({ success: true });
    return false;
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
  if (!needle) return false;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return new RegExp(
    `(^|[^0-9A-Za-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Za-z]|$)`,
    "i"
  ).test(text);
}

function readCaptureLog() {
  try {
    return JSON.parse(sessionStorage.getItem(CAPTURE_KEY) || "[]");
  } catch {
    return [];
  }
}

function summarizeCaptureEntry(entry) {
  return {
    method: entry.method,
    status: entry.status,
    url: entry.url,
    ts: entry.ts
  };
}

function findIdInCapture(ids) {
  const log = readCaptureLog();
  const hits = [];

  for (const id of ids) {
    for (const entry of log) {
      const inUrl = responseContainsId(entry.url, id);
      const inBody = responseContainsId(entry.body || "", id);
      if (inUrl || inBody) {
        hits.push({
          id,
          where: inUrl && inBody ? "url+body" : inUrl ? "url" : "body",
          method: entry.method,
          status: entry.status,
          url: entry.url,
          snippet: snippetAround(entry.body || "", id)
        });
      }
    }
  }

  return hits;
}

function snippetAround(text, id, radius = 80) {
  const re = new RegExp(String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const match = re.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + String(id).length + radius);
  return text.slice(start, end).replace(/\s+/g, " ");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: authHeaders(), credentials: "include" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text, url };
}

function buildProbeUrls(visitId) {
  const base = `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}`;
  const selectors = [
    "protocols",
    "protocols(id,name,protocolName)",
    "specialTests",
    "specialTesting",
    "diagnosticTests",
    "orders",
    "orderRequests",
    "interpretations",
    "plans",
    "procedures",
    "tests",
    "diagnoses(diagnosisName)",
    "ordersSent,hasSendableLabOrderRequest"
  ];

  const urls = [
    `${base}/protocols?orderVersion=0&selector=ordersSent,hasSendableLabOrderRequest`,
    `${base}/protocols`,
    `${base}/specialTests`,
    `${base}/special-tests`,
    `${base}/specialTesting`,
    `${base}/diagnosticTests`,
    `${base}/orders`,
    `${base}/tests`
  ];

  for (const selector of selectors) {
    urls.push(`${base}?selector=${encodeURIComponent(selector)}`);
  }

  return [...new Set(urls)];
}

async function probeVisitEndpoints(visitId, requestedIds) {
  const probeHits = [];
  const endpointResults = [];

  for (const url of buildProbeUrls(visitId)) {
    try {
      const { ok, status, text } = await fetchText(url);
      const matchedIds = requestedIds.filter((id) => responseContainsId(text, id));
      endpointResults.push({
        url,
        status,
        ok,
        matchedIds,
        bodyLength: text.length
      });

      for (const id of matchedIds) {
        probeHits.push({
          id,
          where: "probe-body",
          method: "GET",
          status,
          url,
          snippet: snippetAround(text, id)
        });
      }
    } catch (err) {
      endpointResults.push({
        url,
        status: 0,
        ok: false,
        matchedIds: [],
        error: err.message
      });
    }
  }

  return { probeHits, endpointResults };
}

async function discoverWhereIdsAppear(requestedIds) {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Open a visit note or refresh the ModMed page.");
  }

  if (requestedIds.length === 0) {
    return {
      visitId,
      appliedIds: [],
      missingIds: [],
      hits: [],
      captureCount: readCaptureLog().length,
      note: "No protocol IDs selected."
    };
  }

  const captureHits = findIdInCapture(requestedIds);
  const { probeHits, endpointResults } = await probeVisitEndpoints(visitId, requestedIds);

  const hits = [...captureHits, ...probeHits];
  const appliedIds = [...new Set(hits.map((h) => h.id))];
  const missingIds = requestedIds.filter((id) => !appliedIds.includes(id));

  // Helpful signal: which probe URLs returned 200 with any JSON payload.
  const readableEndpoints = endpointResults
    .filter((e) => e.ok && e.bodyLength > 2)
    .map((e) => ({ url: e.url, status: e.status, matchedIds: e.matchedIds }));

  return {
    visitId,
    appliedIds,
    missingIds,
    hits,
    captureCount: readCaptureLog().length,
    readableEndpoints,
    note:
      missingIds.length && !captureHits.length
        ? "ID not found in probed endpoints or captured traffic. Open the visit UI (Special Testing / Protocols), then click Test again — the interceptor records live /ema/ws calls."
        : undefined
  };
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
