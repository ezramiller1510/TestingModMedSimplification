const BUTTON_IDS = ["collectBtn", "checkBtn", "copyBtn", "applyMappedBtn"];

function setBusy(busy, statusText) {
  BUTTON_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });
  if (statusText != null) document.getElementById("status").textContent = statusText;
}

async function getActiveModMedTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("modmedapp.com")) {
    throw new Error("Open a ModMed tab first.");
  }
  return tab;
}

function sendToTab(action, payload = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const tab = await getActiveModMedTab();
      chrome.tabs.sendMessage(tab.id, { action, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error("Connection failed—try refreshing the ModMed tab."));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function loadMappings() {
  const stored = await chrome.storage.local.get(["protocolMappings"]);
  return stored.protocolMappings || {};
}

function renderTargets(mappings) {
  const list = document.getElementById("targetList");
  const select = document.getElementById("manualTarget");
  list.innerHTML = "";
  select.innerHTML = "";

  PROTOCOL_TARGETS.forEach((target) => {
    const m = mappings[target.key] || emptyMapping(target);
    const hasProtocol = Boolean(m.protocolId);
    const hasProcedure = Boolean(m.procedureCatalogId || (m.procedureCatalogIds || []).length);
    const procLabel = m.procedureName || m.procedureAlias || "";

    const row = document.createElement("div");
    row.className = "target";
    row.innerHTML =
      `<strong>${target.name}</strong><br>` +
      `<span class="${hasProtocol ? "ok" : "missing"}">protocolId: ${m.protocolId || "missing"}</span><br>` +
      `<span class="${hasProcedure ? "ok" : "missing"}">procedureCatalogId: ${m.procedureCatalogId || "missing"}</span>` +
      (procLabel ? ` <span>(${procLabel})</span>` : "");
    list.appendChild(row);

    const opt = document.createElement("option");
    opt.value = target.key;
    opt.textContent = target.name;
    select.appendChild(opt);
  });
}

function formatCollectResult(response) {
  if (!response?.success) return "Error: " + (response?.error || "Unknown error");

  const lines = [
    `Visit: ${response.visitId}`,
    `Overview source: ${response.overviewSource}`,
    `Captured calls: ${response.captureCount}`,
    "",
    "Mappings:"
  ];

  (response.mappings || []).forEach((m) => {
    lines.push(
      `- ${m.name}: protocolId=${m.protocolId || "?"} procedureCatalogId=${m.procedureCatalogId || "?"} (${m.procedureName || m.procedureAlias || "—"})`
    );
  });

  if (response.note) {
    lines.push("", response.note);
  }

  return lines.join("\n");
}

function formatCheckResult(response) {
  if (!response?.success) return "Error: " + (response?.error || "Unknown error");

  const lines = [`Visit: ${response.visitId}`, ""];
  (response.results || []).forEach((r) => {
    lines.push(`${r.applied ? "✓" : "·"} ${r.name}: ${r.reason}`);
  });
  lines.push("", `Applied: ${(response.applied || []).join(", ") || "none"}`);
  lines.push(`Missing: ${(response.missing || []).join(", ") || "none"}`);
  return lines.join("\n");
}

async function refreshUi(statusText) {
  const mappings = await loadMappings();
  renderTargets(mappings);
  if (statusText != null) document.getElementById("status").textContent = statusText;
}

document.getElementById("collectBtn").addEventListener("click", async () => {
  setBusy(true, "Collecting from visit overview + captured traffic...");
  try {
    const response = await sendToTab("COLLECT_PROTOCOL_IDS");
    await refreshUi(formatCollectResult(response));
  } catch (err) {
    setBusy(false, err.message);
    return;
  }
  setBusy(false);
});

document.getElementById("checkBtn").addEventListener("click", async () => {
  setBusy(true, "Checking visit overview for procedure catalog IDs...");
  try {
    const response = await sendToTab("CHECK_TARGETS_APPLIED");
    await refreshUi(formatCheckResult(response));
  } catch (err) {
    setBusy(false, err.message);
    return;
  }
  setBusy(false);
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  const mappings = await loadMappings();
  const payload = PROTOCOL_TARGETS.map((t) => mappings[t.key] || emptyMapping(t));
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("status").textContent = "Copied mappings JSON to clipboard.";
  } catch {
    document.getElementById("status").textContent = text;
  }
});

document.getElementById("applyMappedBtn").addEventListener("click", async () => {
  await saveManualProtocolId();
  const refreshed = await loadMappings();
  const uniqueIds = [
    ...new Set(PROTOCOL_TARGETS.map((t) => refreshed[t.key]?.protocolId).filter(Boolean))
  ];

  if (!uniqueIds.length) {
    document.getElementById("status").textContent =
      "No protocolIds collected yet. Open Protocols UI, capture traffic, Collect, or enter an ID manually below.";
    return;
  }

  setBusy(true, `Applying protocolIds: ${uniqueIds.join(", ")}...`);

  try {
    const response = await sendToTab("APPLY_PROTOCOLS", { protocolIds: uniqueIds });
    if (response?.success) {
      setBusy(false, "Applied! Reloading page...");
      setTimeout(() => window.close(), 600);
    } else {
      setBusy(false, "Error: " + (response?.error || "Unknown error"));
    }
  } catch (err) {
    setBusy(false, err.message);
  }
});

async function saveManualProtocolId() {
  const protocolId = document.getElementById("manualProtocolId").value.trim();
  const key = document.getElementById("manualTarget").value;
  if (!protocolId) return;

  const mappings = await loadMappings();
  const target = PROTOCOL_TARGETS.find((t) => t.key === key);
  const current = mappings[key] || emptyMapping(target);
  current.protocolId = protocolId;
  current.updatedAt = new Date().toISOString();
  current.sources = [...new Set([...(current.sources || []), "manual"])];
  mappings[key] = current;
  await chrome.storage.local.set({ protocolMappings: mappings });
  await refreshUi(`Saved protocolId ${protocolId} for ${target.name}.`);
}

document.getElementById("manualProtocolId").addEventListener("change", saveManualProtocolId);
document.getElementById("manualTarget").addEventListener("change", () => {
  // keep typed id ready to save against newly selected target
});

refreshUi("");
