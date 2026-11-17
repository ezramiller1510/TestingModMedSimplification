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

  if (message.action === "COLLECT_PROTOCOL_IDS") {
    collectProtocolIdsForTargets()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "CHECK_TARGETS_APPLIED") {
    checkTargetsApplied()
      .then((result) => sendResponse({ success: true, ...result }))
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

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildOverviewUrls(visitId) {
  const base = `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}`;
  return [
    `${base}/overview`,
    `${base}/visitOverview`,
    `${base}?selector=diagnoses`,
    `${base}?selector=${encodeURIComponent("diagnoses(diagnosisName,diagnosis,procedures,veProcedure,specialPlan,specialDiagnosisType)")}`,
    `${base}?selector=${encodeURIComponent("unworthyDiagnoses,diagnoses")}`
  ];
}

async function loadVisitOverview(visitId) {
  // Prefer a captured overview body (has impressionsPlansDto) if present.
  for (const entry of readCaptureLog().slice().reverse()) {
    if (!entry.body || !/impressionsPlansDto|unworthyDiagnoses|"diagnoses"\s*:/.test(entry.body)) {
      continue;
    }
    if (!String(entry.url || "").includes(String(visitId))) continue;
    const parsed = parseJsonSafe(entry.body);
    if (parsed && (parsed.diagnoses || parsed.visit || parsed.impressionsPlansDto)) {
      return { data: parsed, url: entry.url, source: "capture" };
    }
  }

  for (const url of buildOverviewUrls(visitId)) {
    try {
      const { ok, text } = await fetchText(url);
      if (!ok) continue;
      const parsed = parseJsonSafe(text);
      if (!parsed) continue;
      if (parsed.diagnoses || parsed.impressionsPlansDto || parsed.unworthyDiagnoses) {
        return { data: parsed, url, source: "probe" };
      }
    } catch {
      // try next
    }
  }

  throw new Error(
    "Could not load visit overview. Open Visit Overview in ModMed so it appears in captured traffic, then collect again."
  );
}

function listOverviewProcedures(overview) {
  const diagnoses = [].concat(overview.diagnoses || []);
  const out = [];

  for (const dx of diagnoses) {
    const dxName = dx.diagnosisName || dx.diagnosisNameWithRO || dx.diagnosis?.diagnosisName || "";
    const diagnosisCatalogId = dx.diagnosis?.id != null ? String(dx.diagnosis.id) : null;

    for (const p of dx.procedures || []) {
      out.push({
        name: p.procedure || p.veProcedure?.name || "",
        alias: p.veProcedure?.procedureAlias || "",
        catalogId: p.veProcedure?.id != null ? String(p.veProcedure.id) : null,
        visitProcedureId: p.id != null ? String(p.id) : null,
        diagnosisName: dxName || null,
        diagnosisCatalogId
      });
    }
  }

  return out.filter((p) => p.catalogId);
}

function collectCatalogFromOverview(overview) {
  // Detect by procedure only. Diagnosis names are too coarse (one special-test
  // diagnosis can own Optos + Anterior Segment + other imaging).
  const procedures = listOverviewProcedures(overview);
  const found = [];

  for (const target of PROTOCOL_TARGETS) {
    const procedureHits = procedures.filter(
      (p) => targetMatchesText(target, p.name) || targetMatchesText(target, p.alias)
    );
    if (!procedureHits.length) continue;

    const primary = procedureHits[0];
    found.push({
      key: target.key,
      name: target.name,
      procedureCatalogId: primary.catalogId,
      procedureName: primary.name || null,
      procedureAlias: primary.alias || null,
      procedures: procedureHits,
      diagnosisName: primary.diagnosisName,
      diagnosisCatalogId: primary.diagnosisCatalogId,
      matchedBy: "procedure-name"
    });
  }

  return found;
}

function walkProtocolCandidates(value, out = [], seen = new Set()) {
  if (value == null || typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => walkProtocolCandidates(item, out, seen));
    return out;
  }

  const name =
    value.name ||
    value.protocolName ||
    value.label ||
    value.title ||
    value.displayName ||
    "";
  const id =
    value.protocolId ??
    value.protocolDefinitionId ??
    value.masterVisitId ??
    value.id;

  if (name && id != null && /^\d+$/.test(String(id))) {
    out.push({ name: String(name), protocolId: String(id), raw: value });
  }

  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") walkProtocolCandidates(child, out, seen);
  });

  return out;
}

function collectProtocolIdsFromCapture() {
  const hits = [];

  for (const entry of readCaptureLog()) {
    const body = entry.body || "";
    if (!body) continue;

    const looksUseful =
      /protocol/i.test(entry.url || "") ||
      /protocol/i.test(body) ||
      entry.method === "POST";
    if (!looksUseful) continue;

    const parsed = parseJsonSafe(body);
    if (!parsed) continue;

    for (const candidate of walkProtocolCandidates(parsed)) {
      for (const target of PROTOCOL_TARGETS) {
        if (!targetMatchesText(target, candidate.name)) continue;
        hits.push({
          key: target.key,
          name: target.name,
          protocolId: candidate.protocolId,
          protocolName: candidate.name,
          sourceUrl: entry.url,
          method: entry.method
        });
      }
    }
  }

  return hits;
}

function mergeMapping(existing, patch, source) {
  const next = existing ? { ...existing } : emptyMapping(PROTOCOL_TARGETS.find((t) => t.key === patch.key) || patch);
  const sources = new Set(next.sources || []);

  if (patch.protocolId) next.protocolId = String(patch.protocolId);

  // Diagnosis is contextual only
  if (patch.diagnosisCatalogId) next.diagnosisCatalogId = String(patch.diagnosisCatalogId);
  if (patch.diagnosisName) next.diagnosisName = patch.diagnosisName;

  const procMap = new Map((next.procedures || []).map((p) => [String(p.catalogId), p]));
  for (const p of patch.procedures || []) {
    if (!p.catalogId) continue;
    procMap.set(String(p.catalogId), {
      name: p.name || "",
      alias: p.alias || "",
      catalogId: String(p.catalogId)
    });
  }

  if (patch.procedureCatalogId) {
    procMap.set(String(patch.procedureCatalogId), {
      name: patch.procedureName || patch.name || "",
      alias: patch.procedureAlias || "",
      catalogId: String(patch.procedureCatalogId)
    });
  }

  next.procedures = [...procMap.values()];
  next.procedureCatalogIds = next.procedures.map((p) => p.catalogId);

  const primaryId = patch.procedureCatalogId || next.procedureCatalogId || next.procedureCatalogIds[0] || null;
  if (primaryId) {
    next.procedureCatalogId = String(primaryId);
    const primary = next.procedures.find((p) => p.catalogId === String(primaryId));
    if (primary) {
      next.procedureName = primary.name || next.procedureName || null;
      next.procedureAlias = primary.alias || next.procedureAlias || null;
    }
  }
  if (patch.procedureName) next.procedureName = patch.procedureName;
  if (patch.procedureAlias) next.procedureAlias = patch.procedureAlias;

  if (source) sources.add(source);
  next.sources = [...sources];
  next.updatedAt = new Date().toISOString();
  return next;
}

async function collectProtocolIdsForTargets() {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Open a visit note first.");
  }

  const overview = await loadVisitOverview(visitId);
  const catalogHits = collectCatalogFromOverview(overview.data);
  const protocolHits = collectProtocolIdsFromCapture();

  const stored = await chrome.storage.local.get(["protocolMappings"]);
  const mappings = { ...(stored.protocolMappings || {}) };

  for (const target of PROTOCOL_TARGETS) {
    if (!mappings[target.key]) mappings[target.key] = emptyMapping(target);
  }

  for (const hit of catalogHits) {
    mappings[hit.key] = mergeMapping(mappings[hit.key], hit, `overview:${overview.source}`);
  }

  for (const hit of protocolHits) {
    mappings[hit.key] = mergeMapping(
      mappings[hit.key],
      { key: hit.key, name: hit.name, protocolId: hit.protocolId, procedures: [] },
      `capture:${hit.method}`
    );
  }

  await chrome.storage.local.set({ protocolMappings: mappings });

  return {
    visitId,
    overviewUrl: overview.url,
    overviewSource: overview.source,
    catalogHits,
    protocolHits,
    mappings: PROTOCOL_TARGETS.map((t) => mappings[t.key]),
    captureCount: readCaptureLog().length,
    note:
      protocolHits.length === 0
        ? "Procedure catalog IDs come from Visit Overview procedures. Protocol apply IDs need Protocols list/search or apply POST in captured traffic — open Protocols UI, search these names, then Collect again."
        : undefined
  };
}

async function checkTargetsApplied() {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Open a visit note first.");
  }

  const stored = await chrome.storage.local.get(["protocolMappings"]);
  const mappings = stored.protocolMappings || {};
  const overview = await loadVisitOverview(visitId);
  const overviewProcedures = listOverviewProcedures(overview.data);
  const catalogHits = collectCatalogFromOverview(overview.data);
  const hitKeys = new Set(catalogHits.map((h) => h.key));

  const results = PROTOCOL_TARGETS.map((target) => {
    const mapping = mappings[target.key] || emptyMapping(target);
    const overviewHit = catalogHits.find((h) => h.key === target.key) || null;
    const wantedIds = new Set(
      []
        .concat(mapping.procedureCatalogId ? [String(mapping.procedureCatalogId)] : [])
        .concat(mapping.procedureCatalogIds || [])
        .map(String)
    );

    let applied = false;
    let reason = "procedure not found on visit overview";
    let matchedProcedure = null;

    if (wantedIds.size) {
      matchedProcedure = overviewProcedures.find((p) => wantedIds.has(String(p.catalogId)));
      if (matchedProcedure) {
        applied = true;
        reason = `procedure catalog ${matchedProcedure.catalogId} (${matchedProcedure.name || matchedProcedure.alias || target.name})`;
      }
    } else if (overviewHit?.procedureCatalogId) {
      // No saved mapping yet, but name/alias matched a procedure on this visit.
      applied = true;
      matchedProcedure = overviewHit;
      reason = `procedure name match ${overviewHit.procedureCatalogId} (${overviewHit.procedureName || target.name}) — collect to save ID`;
    }

    return {
      key: target.key,
      name: target.name,
      applied,
      reason,
      mapping,
      overviewHit,
      matchedProcedure
    };
  });

  return {
    visitId,
    overviewUrl: overview.url,
    results,
    applied: results.filter((r) => r.applied).map((r) => r.name),
    missing: results.filter((r) => !r.applied).map((r) => r.name),
    knownKeys: Object.keys(mappings),
    hitKeys: [...hitKeys]
  };
}
