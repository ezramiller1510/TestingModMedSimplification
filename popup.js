const MAIN_BUTTONS = ["abnApplyBtn", "refreshBtn", "reconfigureBtn"];
const SETTINGS_BUTTONS = ["addBtn", "collectBtn", "copyBtn", "backBtn", "saveAbnSettingsBtn"];

function $(id) {
  return document.getElementById(id);
}

function setBusy(busy, statusText, which = "main") {
  const ids = which === "settings" ? SETTINGS_BUTTONS : MAIN_BUTTONS;
  ids.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy;
  });
  // Also disable protocol checkboxes while busy
  document.querySelectorAll('#protocolTable input[type="checkbox"]').forEach((cb) => {
    cb.disabled = busy;
  });
  if (statusText != null) {
    $(which === "settings" ? "settingsStatus" : "status").textContent = statusText;
  }
}

function showMain() {
  $("mainView").classList.remove("hidden");
  $("settingsView").classList.add("hidden");
}

function showSettings() {
  $("settingsView").classList.remove("hidden");
  $("mainView").classList.add("hidden");
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

async function loadState() {
  const stored = await chrome.storage.local.get([
    "trackedProtocols",
    "protocolMappings",
    "abnSettings",
    "abnExtraText"
  ]);
  return {
    tracked: Array.isArray(stored.trackedProtocols) ? stored.trackedProtocols : [],
    mappings: stored.protocolMappings || {},
    abnSettings: stored.abnSettings || {
      protocolId: null,
      procedureCatalogId: null,
      aliases: ["ABN", "ABN signed"]
    },
    abnExtraText: stored.abnExtraText || ""
  };
}

function renderSettingsList(tracked, mappings) {
  const list = $("targetList");
  list.innerHTML = "";

  if (!tracked.length) {
    list.innerHTML = `<div class="muted">No tracked tests yet. Add one above.</div>`;
    return;
  }

  tracked.forEach((target) => {
    const m = mappings[target.key] || emptyMapping(target);
    const protocolId = target.protocolId || m.protocolId || null;
    const procedureId = m.procedureCatalogId || target.procedureCatalogId || null;
    const procLabel = m.procedureName || m.procedureAlias || "";

    const row = document.createElement("div");
    row.className = "target";
    row.innerHTML = `
      <div class="target-head">
        <strong></strong>
        <button type="button" class="danger" data-remove="${target.key}">Remove</button>
      </div>
      <span class="${protocolId ? "ok" : "missing"}">protocolId: ${protocolId || "missing"}</span><br>
      <span class="${procedureId ? "ok" : "missing"}">procedureCatalogId: ${procedureId || "missing"}</span>
      ${procLabel ? ` <span>(${procLabel})</span>` : ""}
      ${(target.aliases || []).length ? `<br><span class="muted">aliases: ${target.aliases.join(", ")}</span>` : ""}
    `;
    row.querySelector("strong").textContent = target.name;
    list.appendChild(row);
  });

  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.getAttribute("data-remove");
      const state = await loadState();
      const trackedNext = state.tracked.filter((t) => t.key !== key);
      const mappingsNext = { ...state.mappings };
      delete mappingsNext[key];
      await chrome.storage.local.set({
        trackedProtocols: trackedNext,
        protocolMappings: mappingsNext
      });
      await refreshSettings("Removed tracked test.");
    });
  });
}

function renderMainTable(results) {
  const table = $("protocolTable");
  table.innerHTML = "";

  if (!results.length) {
    table.innerHTML = `<div class="empty">No tracked protocols yet. Open Reconfigure to add some.</div>`;
    return;
  }

  results.forEach((r) => {
    const row = document.createElement("div");
    row.className = "protocol-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(r.applied);
    checkbox.dataset.key = r.key;
    checkbox.title = r.reason || "";

    const name = document.createElement("div");
    name.textContent = r.name;

    const pill = document.createElement("span");
    pill.className = `status-pill ${r.applied ? "on" : "off"}`;
    pill.textContent = r.applied ? "Applied" : "Not applied";

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(pill);

    checkbox.addEventListener("change", () => onProtocolToggle(r, checkbox, pill));
    table.appendChild(row);
  });
}

function renderAbnIndicator(abn) {
  const el = $("abnIndicator");
  if (abn?.applied) {
    el.className = "abn-indicator on";
    el.textContent = "ABN applied";
  } else {
    el.className = "abn-indicator off";
    el.textContent = "ABN not applied";
  }
}

async function refreshMain(statusText) {
  const state = await loadState();
  $("abnText").value = state.abnExtraText || "";

  if (!state.tracked.length) {
    renderMainTable([]);
    renderAbnIndicator({ applied: false });
    if (statusText != null) $("status").textContent = statusText;
    return;
  }

  setBusy(true, statusText || "Loading visit status...");
  try {
    const response = await sendToTab("GET_MAIN_STATUS");
    if (!response?.success) throw new Error(response?.error || "Failed to load status");

    renderMainTable(response.results || []);
    renderAbnIndicator(response.abn || { applied: false });
    $("status").textContent =
      statusText ||
      `Visit ${response.visitId || "?"} · ${(response.applied || []).length}/${(response.results || []).length} applied`;
  } catch (err) {
    renderMainTable(
      state.tracked.map((t) => ({
        key: t.key,
        name: t.name,
        applied: false,
        reason: err.message
      }))
    );
    renderAbnIndicator({ applied: false });
    $("status").textContent = err.message;
  }
  setBusy(false);
}

async function refreshSettings(statusText) {
  const state = await loadState();
  renderSettingsList(state.tracked, state.mappings);
  $("abnProtocolId").value = state.abnSettings.protocolId || "";
  $("abnProcedureId").value = state.abnSettings.procedureCatalogId || "";
  $("abnAliases").value = (state.abnSettings.aliases || []).join(", ");
  if (statusText != null) $("settingsStatus").textContent = statusText;
}

async function onProtocolToggle(item, checkbox, pill) {
  const wantApplied = checkbox.checked;
  setBusy(true, wantApplied ? `Applying ${item.name}...` : `Removing ${item.name}...`);

  try {
    const response = await sendToTab(wantApplied ? "APPLY_TRACKED" : "UNAPPLY_TRACKED", {
      key: item.key,
      reload: true
    });
    if (!response?.success) throw new Error(response?.error || "Request failed");

    pill.className = `status-pill ${wantApplied ? "on" : "off"}`;
    pill.textContent = wantApplied ? "Applied" : "Not applied";
    $("status").textContent = wantApplied
      ? `Applied ${item.name}. Reloading page...`
      : `Removed ${item.name}. Reloading page...`;
  } catch (err) {
    checkbox.checked = !wantApplied;
    $("status").textContent = err.message;
    setBusy(false);
  }
}

$("refreshBtn").addEventListener("click", () => refreshMain("Refreshing..."));
$("reconfigureBtn").addEventListener("click", async () => {
  showSettings();
  await refreshSettings("");
});
$("backBtn").addEventListener("click", async () => {
  showMain();
  await refreshMain("");
});

$("abnText").addEventListener("change", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
});
$("abnText").addEventListener("blur", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
});

$("abnApplyBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
  setBusy(true, "Applying ABN signed...");
  try {
    const response = await sendToTab("APPLY_ABN", {
      extraText: $("abnText").value,
      reload: true
    });
    if (!response?.success) throw new Error(response?.error || "ABN apply failed");
    renderAbnIndicator({ applied: true });
    $("status").textContent = "ABN signed applied. Reloading page...";
  } catch (err) {
    setBusy(false, err.message);
  }
});

$("addBtn").addEventListener("click", async () => {
  try {
    const item = createTrackedProtocol({
      name: $("newName").value,
      protocolId: $("newProtocolId").value,
      aliases: $("newAliases").value,
      procedureCatalogId: $("newProcedureId").value
    });
    const state = await loadState();
    const filtered = state.tracked.filter(
      (t) => normalizeLabel(t.name) !== normalizeLabel(item.name)
    );
    filtered.push(item);

    const mappingsNext = { ...state.mappings };
    Object.keys(mappingsNext).forEach((key) => {
      if (normalizeLabel(mappingsNext[key]?.name) === normalizeLabel(item.name)) {
        delete mappingsNext[key];
      }
    });
    mappingsNext[item.key] = emptyMapping(item);

    await chrome.storage.local.set({
      trackedProtocols: filtered,
      protocolMappings: mappingsNext
    });

    $("newName").value = "";
    $("newProtocolId").value = "";
    $("newAliases").value = "";
    $("newProcedureId").value = "";
    await refreshSettings(`Tracking “${item.name}”.`);
  } catch (err) {
    $("settingsStatus").textContent = err.message;
  }
});

$("saveAbnSettingsBtn").addEventListener("click", async () => {
  const aliasesRaw = $("abnAliases").value.trim();
  const abnSettings = {
    protocolId: $("abnProtocolId").value.trim() || null,
    procedureCatalogId: $("abnProcedureId").value.trim() || null,
    aliases: aliasesRaw ? parseAliases(aliasesRaw) : ["ABN", "ABN signed"]
  };
  await chrome.storage.local.set({ abnSettings });
  $("settingsStatus").textContent = "Saved ABN settings.";
});

$("collectBtn").addEventListener("click", async () => {
  setBusy(true, "Collecting procedure IDs...", "settings");
  try {
    const response = await sendToTab("COLLECT_PROTOCOL_IDS");
    if (!response?.success) throw new Error(response?.error || "Collect failed");
    const lines = (response.mappings || []).map(
      (m) =>
        `- ${m.name}: protocolId=${m.protocolId || "?"} procedureCatalogId=${m.procedureCatalogId || "?"}`
    );
    await refreshSettings(
      [`Visit: ${response.visitId}`, "", ...lines, response.note ? `\n${response.note}` : ""]
        .filter(Boolean)
        .join("\n")
    );
  } catch (err) {
    setBusy(false, err.message, "settings");
    return;
  }
  setBusy(false, null, "settings");
});

$("copyBtn").addEventListener("click", async () => {
  const state = await loadState();
  const payload = {
    tracked: state.tracked.map((t) => {
      const m = state.mappings[t.key] || emptyMapping(t);
      return {
        key: t.key,
        name: t.name,
        aliases: t.aliases || [],
        protocolId: t.protocolId || m.protocolId || null,
        procedureCatalogId: m.procedureCatalogId || t.procedureCatalogId || null,
        procedureName: m.procedureName || null
      };
    }),
    abnSettings: state.abnSettings,
    abnExtraText: state.abnExtraText
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("settingsStatus").textContent = "Copied tracked JSON to clipboard.";
  } catch {
    $("settingsStatus").textContent = text;
  }
});

refreshMain("");
