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
    applyProtocolsToVisit(message.protocolIds || [], { reload: message.reload !== false })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "APPLY_TRACKED") {
    applyTrackedByKey(message.key, { reload: message.reload !== false })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "UNAPPLY_TRACKED") {
    unapplyTrackedByKey(message.key, { reload: message.reload !== false })
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "GET_MAIN_STATUS") {
    getMainStatus()
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "APPLY_ABN") {
    applyAbnSigned(message.extraText || "", { reload: message.reload !== false })
      .then((result) => sendResponse({ success: true, ...result }))
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

async function applyProtocolsToVisit(protocolIds, { reload = true } = {}) {
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

  if (reload) window.location.reload();
  return { visitId, protocolIds: ids };
}

async function fetchDelete(url) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
    credentials: "include"
  });
  return { ok: res.ok, status: res.status, url };
}

async function deleteVisitDiagnosis(visitDiagnosisId) {
  const id = String(visitDiagnosisId || "").trim();
  if (!id) throw new Error("Missing visitDiagnosis id for delete.");

  const url = `https://rep.modmedapp.com/ema/ws/v3/visitDiagnosis/${id}?orderVersion=0`;
  const result = await fetchDelete(url);
  if (!result.ok) {
    throw new Error(`Could not delete visitDiagnosis ${id}. Status: ${result.status}`);
  }
  return result;
}

function listOverviewProceduresDetailed(overview) {
  const out = [];
  const diagnoses = [].concat(overview.diagnoses || []).concat(overview.unworthyDiagnoses || []);

  for (const dx of diagnoses) {
    const dxName = dx.diagnosisName || dx.diagnosisNameWithRO || dx.diagnosis?.diagnosisName || "";
    const visitDiagnosisId = dx.id != null ? String(dx.id) : null;
    const procedures = dx.procedures || [];

    if (!procedures.length && visitDiagnosisId) {
      // Diagnosis-only row (e.g. unworthyDiagnoses) — still removable via visitDiagnosis DELETE.
      out.push({
        name: dxName || "",
        alias: "",
        catalogId: dx.diagnosis?.id != null ? String(dx.diagnosis.id) : null,
        visitProcedureId: null,
        visitDiagnosisId,
        diagnosisName: dxName || null,
        diagnosisCatalogId: dx.diagnosis?.id != null ? String(dx.diagnosis.id) : null,
        deletable: true
      });
      continue;
    }

    for (const p of procedures) {
      out.push({
        name: p.procedure || p.veProcedure?.name || "",
        alias: p.veProcedure?.procedureAlias || "",
        catalogId: p.veProcedure?.id != null ? String(p.veProcedure.id) : null,
        visitProcedureId: p.id != null ? String(p.id) : null,
        visitDiagnosisId,
        diagnosisName: dxName || null,
        diagnosisCatalogId: dx.diagnosis?.id != null ? String(dx.diagnosis.id) : null,
        deletable: p.veVisitDiagnosisProcedureStatusDto?.procedureDeletable !== false
      });
    }
  }

  return out.filter((p) => p.visitDiagnosisId);
}

async function getTrackedByKey(key) {
  const targets = await getTrackedTargets();
  const target = targets.find((t) => t.key === key);
  if (!target) throw new Error("Tracked protocol not found.");
  return target;
}

async function applyTrackedByKey(key, { reload = true } = {}) {
  const target = await getTrackedByKey(key);
  if (!target.protocolId) {
    throw new Error(`No protocolId configured for “${target.name}”. Add it in Settings.`);
  }
  return applyProtocolsToVisit([target.protocolId], { reload });
}

function findMatchingOverviewProcedures(target, procedures) {
  const wantedIds = new Set(
    []
      .concat(target.procedureCatalogId ? [String(target.procedureCatalogId)] : [])
      .concat(target.procedureCatalogIds || [])
      .map(String)
      .filter(Boolean)
  );

  let matches = procedures.filter((p) => p.catalogId && wantedIds.has(String(p.catalogId)));
  if (matches.length) return matches;

  return procedures.filter(
    (p) =>
      targetMatchesText(target, p.name) ||
      targetMatchesText(target, p.alias) ||
      targetMatchesText(target, p.diagnosisName)
  );
}

async function unapplyTrackedByKey(key, { reload = true } = {}) {
  const visitId = getActiveVisitId();
  if (!visitId) throw new Error("Could not detect Visit ID.");

  const target = await getTrackedByKey(key);
  const overview = await loadVisitOverview(visitId, { forceProbe: true });
  const procedures = listOverviewProceduresDetailed(overview.data);
  console.log(overview)
  const matches = findMatchingOverviewProcedures(target, procedures);

  if (!matches.length) {
    const available = procedures
      .map((p) => p.name || p.alias || p.diagnosisName)
      .filter(Boolean)
      .slice(0, 12);
    throw new Error(
      `“${target.name}” does not appear applied on this visit.` +
        (available.length
          ? ` Procedures seen: ${available.join("; ")}. Add one of those as an alias or Collect procedure IDs.`
          : " No procedures were found in visit overview.")
    );
  }

  // ModMed removes applied protocol content via visitDiagnosis DELETE.
  const diagnosisIds = [...new Set(matches.map((m) => String(m.visitDiagnosisId)).filter(Boolean))];
  const deleted = [];
  for (const visitDiagnosisId of diagnosisIds) {
    const result = await deleteVisitDiagnosis(visitDiagnosisId);
    deleted.push({ visitDiagnosisId, deleteStatus: result.status, deleteUrl: result.url });
  }

  if (reload) window.location.reload();
  return { visitId, deleted };
}

function getAbnTargetFromSettings(abnSettings) {
  return {
    key: "abn-signed",
    name: "ABN signed",
    aliases: parseAliases(abnSettings?.aliases?.length ? abnSettings.aliases : ["ABN", "ABN signed"]),
    protocolId: abnSettings?.protocolId || null,
    procedureCatalogId: abnSettings?.procedureCatalogId || null,
    procedureCatalogIds: abnSettings?.procedureCatalogId
      ? [String(abnSettings.procedureCatalogId)]
      : []
  };
}

function detectAbnFromOverview(overview, abnTarget) {
  const procedures = listOverviewProcedures(overview);
  if (abnTarget.procedureCatalogId) {
    const byId = procedures.find((p) => String(p.catalogId) === String(abnTarget.procedureCatalogId));
    if (byId) {
      return {
        applied: true,
        reason: `procedure catalog ${byId.catalogId}`,
        procedure: byId
      };
    }
  }

  const byName = procedures.find(
    (p) => targetMatchesText(abnTarget, p.name) || targetMatchesText(abnTarget, p.alias)
  );
  if (byName) {
    return {
      applied: true,
      reason: `procedure ${byName.catalogId} (${byName.name || byName.alias})`,
      procedure: byName
    };
  }

  // Also scan diagnosis names / free text blobs lightly
  const blob = JSON.stringify(overview);
  if (/\bABN\b/i.test(blob) && /signed/i.test(blob)) {
    return { applied: true, reason: "ABN signed text found in overview payload", procedure: null };
  }

  return { applied: false, reason: "ABN not found on visit overview", procedure: null };
}

async function applyAbnSigned(extraText, { reload = true } = {}) {
  const stored = await chrome.storage.local.get(["abnSettings", "abnExtraText"]);
  const abnSettings = stored.abnSettings || {};
  const text = (extraText != null ? extraText : stored.abnExtraText) || "";
  await chrome.storage.local.set({ abnExtraText: text });

  if (!abnSettings.protocolId) {
    throw new Error("Set an ABN protocol ID in Reconfigure before applying ABN signed.");
  }

  // Apply the ABN protocol first.
  await applyProtocolsToVisit([abnSettings.protocolId], { reload: false });

  // Best-effort: if extra text is present, try attaching it as a diagnosis comment /
  // note on matching ABN procedure after apply. This may no-op depending on EMA shape.
  if (text.trim()) {
    try {
      const visitId = getActiveVisitId();
      const overview = await loadVisitOverview(visitId, { forceProbe: true });
      const abnTarget = getAbnTargetFromSettings(abnSettings);
      const detected = detectAbnFromOverview(overview.data, abnTarget);
      const visitProcedureId = detected.procedure?.visitProcedureId;
      if (visitProcedureId) {
        const noteUrls = [
          `https://rep.modmedapp.com/ema/ws/v3/visitDiagnosisProcedures/${visitProcedureId}`,
          `https://rep.modmedapp.com/ema/ws/v3/procedures/${visitProcedureId}`
        ];
        for (const url of noteUrls) {
          const res = await fetch(url, {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({
              clinicalNotesToTheLab: text,
              comment: text,
              notes: text
            })
          });
          if (res.ok) break;
        }
      }
    } catch (err) {
      console.log("ABN extra text attach skipped:", err.message);
    }
  }

  if (reload) window.location.reload();
  return { applied: true, protocolId: abnSettings.protocolId, extraText: text };
}

async function getMainStatus() {
  const targetStatus = await checkTargetsApplied();
  const stored = await chrome.storage.local.get(["abnSettings"]);
  const abnTarget = getAbnTargetFromSettings(stored.abnSettings || {});

  let abn = { applied: false, reason: "Could not load overview for ABN" };
  try {
    const overview = await loadVisitOverview(targetStatus.visitId);
    abn = detectAbnFromOverview(overview.data, abnTarget);
  } catch (err) {
    abn = { applied: false, reason: err.message };
  }

  return {
    ...targetStatus,
    abn
  };
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

async function loadVisitOverview(visitId, { forceProbe = false } = {}) {
  // Prefer a captured overview body (has impressionsPlansDto) if present.
  if (!forceProbe) {
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

async function getTrackedTargets() {
  const stored = await chrome.storage.local.get(["trackedProtocols", "protocolMappings"]);
  const tracked = Array.isArray(stored.trackedProtocols) ? stored.trackedProtocols : [];
  const mappings = stored.protocolMappings || {};

  // Merge latest mapping fields onto each tracked item for matching/detect.
  return tracked.map((t) => {
    const m = mappings[t.key] || {};
    return {
      ...emptyMapping(t),
      ...t,
      ...m,
      key: t.key,
      name: t.name || m.name,
      aliases: parseAliases(t.aliases || m.aliases),
      protocolId: t.protocolId || m.protocolId || null
    };
  });
}

function collectCatalogFromOverview(overview, targets) {
  // Detect by procedure only. Diagnosis names are too coarse (one special-test
  // diagnosis can own Optos + Anterior Segment + other imaging).
  const procedures = listOverviewProcedures(overview);
  const found = [];

  for (const target of targets) {
    // Prefer exact saved procedure catalog ID when present.
    if (target.procedureCatalogId) {
      const byId = procedures.filter((p) => String(p.catalogId) === String(target.procedureCatalogId));
      if (byId.length) {
        const primary = byId[0];
        found.push({
          key: target.key,
          name: target.name,
          procedureCatalogId: primary.catalogId,
          procedureName: primary.name || null,
          procedureAlias: primary.alias || null,
          procedures: byId,
          diagnosisName: primary.diagnosisName,
          diagnosisCatalogId: primary.diagnosisCatalogId,
          matchedBy: "procedure-id"
        });
        continue;
      }
    }

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

function collectProtocolIdsFromCapture(targets) {
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
      for (const target of targets) {
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
  const next = existing ? { ...existing } : emptyMapping(patch);
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

  const targets = await getTrackedTargets();
  if (!targets.length) {
    throw new Error("No tracked protocols yet. Add a name + protocol ID in the popup first.");
  }

  const overview = await loadVisitOverview(visitId);
  const catalogHits = collectCatalogFromOverview(overview.data, targets);
  const protocolHits = collectProtocolIdsFromCapture(targets);

  const stored = await chrome.storage.local.get(["protocolMappings", "trackedProtocols"]);
  const mappings = { ...(stored.protocolMappings || {}) };
  const tracked = Array.isArray(stored.trackedProtocols) ? [...stored.trackedProtocols] : [];

  for (const target of targets) {
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

  // Keep trackedProtocols in sync when collect finds apply/detect IDs.
  for (let i = 0; i < tracked.length; i++) {
    const m = mappings[tracked[i].key];
    if (!m) continue;
    if (m.protocolId) tracked[i].protocolId = m.protocolId;
    if (m.procedureCatalogId) tracked[i].procedureCatalogId = m.procedureCatalogId;
    if (m.procedureName) tracked[i].procedureName = m.procedureName;
    if (m.procedureAlias) tracked[i].procedureAlias = m.procedureAlias;

    // Persist ModMed's real procedure wording as aliases for future matches.
    const aliasSet = new Set(parseAliases(tracked[i].aliases));
    if (m.procedureName) aliasSet.add(m.procedureName);
    if (m.procedureAlias) aliasSet.add(m.procedureAlias);
    tracked[i].aliases = [...aliasSet];
  }

  await chrome.storage.local.set({ protocolMappings: mappings, trackedProtocols: tracked });

  return {
    visitId,
    overviewUrl: overview.url,
    overviewSource: overview.source,
    catalogHits,
    protocolHits,
    mappings: targets.map((t) => mappings[t.key]),
    captureCount: readCaptureLog().length,
    note:
      protocolHits.length === 0
        ? "Procedure catalog IDs come from Visit Overview procedures (matched by the names you entered). If protocolId is already entered, that’s enough for Apply."
        : undefined
  };
}

async function checkTargetsApplied() {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Open a visit note first.");
  }

  const targets = await getTrackedTargets();
  if (!targets.length) {
    throw new Error("No tracked protocols yet. Add a name + protocol ID in the popup first.");
  }

  const stored = await chrome.storage.local.get(["protocolMappings"]);
  const mappings = stored.protocolMappings || {};
  const overview = await loadVisitOverview(visitId);
  const overviewProcedures = listOverviewProcedures(overview.data);
  const catalogHits = collectCatalogFromOverview(overview.data, targets);
  const hitKeys = new Set(catalogHits.map((h) => h.key));

  const results = targets.map((target) => {
    const mapping = mappings[target.key] || emptyMapping(target);
    const overviewHit = catalogHits.find((h) => h.key === target.key) || null;
    const wantedIds = new Set(
      []
        .concat(mapping.procedureCatalogId ? [String(mapping.procedureCatalogId)] : [])
        .concat(target.procedureCatalogId ? [String(target.procedureCatalogId)] : [])
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
