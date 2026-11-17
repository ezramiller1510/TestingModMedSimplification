function $(id) {
  return document.getElementById(id);
}

function setMainBusy(busy, text) {
  ["applyProtocolsBtn", "refreshMainBtn"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy;
  });
  document.querySelectorAll("#protocolList button, #protocolList input").forEach((el) => {
    el.disabled = busy;
  });
  if (text != null) $("mainStatus").textContent = text;
}

function setSettingsBusy(busy, text) {
  ["addBtn", "collectBtn", "copyBtn"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy;
  });
  if (text != null) $("settingsStatus").textContent = text;
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
    "abnExtraText",
    "abnSelections"
  ]);
  return {
    tracked: Array.isArray(stored.trackedProtocols) ? stored.trackedProtocols : [],
    mappings: stored.protocolMappings || {},
    abnExtraText: stored.abnExtraText != null ? stored.abnExtraText : "ABN signed",
    abnSelections: stored.abnSelections || {}
  };
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  $("mainTab").classList.toggle("hidden", tabName !== "main");
  $("settingsTab").classList.toggle("hidden", tabName !== "settings");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    switchTab(tab.dataset.tab);
    if (tab.dataset.tab === "main") await refreshMain("");
    if (tab.dataset.tab === "settings") await refreshSettings("");
  });
});

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
        <button type="button" class="action danger-sm" data-remove="${target.key}">Remove</button>
      </div>
      <span class="${protocolId ? "ok" : "missing-text"}">protocolId: ${protocolId || "missing"}</span><br>
      <span class="${procedureId ? "ok" : "missing-text"}">procedureCatalogId: ${procedureId || "missing"}</span>
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
      const abnSelections = { ...state.abnSelections };
      delete mappingsNext[key];
      delete abnSelections[key];
      await chrome.storage.local.set({
        trackedProtocols: trackedNext,
        protocolMappings: mappingsNext,
        abnSelections
      });
      await refreshSettings("Removed tracked test.");
    });
  });
}

function renderMainList(results, abnSelections) {
  const list = $("protocolList");
  list.innerHTML = "";

  if (!results.length) {
    list.innerHTML = `<div class="empty">No tracked protocols yet. Switch to Settings to add some.</div>`;
    return;
  }

  results.forEach((r) => {
    const row = document.createElement("div");
    row.className = "protocol-row";

    const top = document.createElement("div");
    top.className = "protocol-row-top";

    const name = document.createElement("div");
    name.className = "protocol-name";
    name.textContent = r.name;

    const status = document.createElement("span");
    status.className = `status ${r.applied ? "applied" : "missing"}`;
    status.textContent = r.applied ? "Applied" : "Not applied";
    status.title = r.reason || "";

    top.appendChild(name);
    top.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "protocol-actions";

    const abnLabel = document.createElement("label");
    abnLabel.className = "abn-check";
    const abnCb = document.createElement("input");
    abnCb.type = "checkbox";
    abnCb.checked = Boolean(abnSelections[r.key]);
    abnCb.addEventListener("change", async () => {
      const state = await loadState();
      const next = { ...state.abnSelections, [r.key]: abnCb.checked };
      await chrome.storage.local.set({ abnSelections: next });
    });
    abnLabel.appendChild(abnCb);
    abnLabel.appendChild(document.createTextNode("Apply ABN text"));

    actions.appendChild(abnLabel);

    if (r.applied) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "action danger-sm";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        setMainBusy(true, `Removing ${r.name}...`);
        try {
          const response = await sendToTab("UNAPPLY_TRACKED", { key: r.key, reload: true });
          if (!response?.success) throw new Error(response?.error || "Remove failed");
          $("mainStatus").textContent = `Removed ${r.name}. Reloading page...`;
        } catch (err) {
          setMainBusy(false, err.message);
        }
      });
      actions.appendChild(removeBtn);
    }

    row.appendChild(top);
    row.appendChild(actions);
    list.appendChild(row);
  });
}

async function refreshSettings(statusText) {
  const state = await loadState();
  renderSettingsList(state.tracked, state.mappings);
  if (statusText != null) $("settingsStatus").textContent = statusText;
}

async function refreshMain(statusText) {
  const state = await loadState();
  $("abnText").value = state.abnExtraText || "ABN signed";

  if (!state.tracked.length) {
    renderMainList([], state.abnSelections);
    if (statusText != null) $("mainStatus").textContent = statusText;
    return;
  }

  setMainBusy(true, statusText || "Checking which protocols are applied...");
  try {
    const response = await sendToTab("GET_MAIN_STATUS");
    if (!response?.success) throw new Error(response?.error || "Failed to load status");
    renderMainList(response.results || [], state.abnSelections);
    $("mainStatus").textContent =
      statusText ||
      `Visit ${response.visitId || "?"} · ${(response.applied || []).length}/${(response.results || []).length} applied`;
  } catch (err) {
    renderMainList(
      state.tracked.map((t) => ({
        key: t.key,
        name: t.name,
        applied: false,
        reason: err.message
      })),
      state.abnSelections
    );
    $("mainStatus").textContent = err.message;
  }
  setMainBusy(false);
}

$("abnText").addEventListener("change", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
});
$("abnText").addEventListener("blur", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
});

$("refreshMainBtn").addEventListener("click", () => refreshMain("Refreshing..."));

$("applyProtocolsBtn").addEventListener("click", async () => {
  await chrome.storage.local.set({ abnExtraText: $("abnText").value });
  const state = await loadState();

  setMainBusy(true, "Checking visit...");
  try {
    const status = await sendToTab("GET_MAIN_STATUS");
    if (!status?.success) throw new Error(status?.error || "Could not read visit status");

    const toApply = (status.results || []).filter((r) => !r.applied);
    const protocolIds = toApply
      .map((r) => {
        const tracked = state.tracked.find((t) => t.key === r.key);
        return tracked?.protocolId || state.mappings[r.key]?.protocolId || null;
      })
      .filter(Boolean);

    if (!protocolIds.length) {
      setMainBusy(false, "Nothing to apply — all tracked protocols are already applied (or missing protocolIds).");
      renderMainList(status.results || [], state.abnSelections);
      return;
    }

    // Remember which selected rows wanted ABN text (for later wiring).
    const abnForApply = toApply
      .filter((r) => state.abnSelections[r.key])
      .map((r) => r.name);

    setMainBusy(
      true,
      `Applying ${protocolIds.length} protocol(s)...` +
        (abnForApply.length ? ` ABN text flagged for: ${abnForApply.join(", ")}` : "")
    );

    const response = await sendToTab("APPLY_PROTOCOLS", {
      protocolIds,
      abnText: $("abnText").value,
      abnKeys: toApply.filter((r) => state.abnSelections[r.key]).map((r) => r.key),
      reload: true
    });
    if (!response?.success) throw new Error(response?.error || "Apply failed");
    $("mainStatus").textContent = "Applied. Reloading page...";
  } catch (err) {
    setMainBusy(false, err.message);
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

$("collectBtn").addEventListener("click", async () => {
  setSettingsBusy(true, "Collecting procedure IDs...");
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
    setSettingsBusy(false, err.message);
    return;
  }
  setSettingsBusy(false);
});

$("copyBtn").addEventListener("click", async () => {
  const state = await loadState();
  const payload = state.tracked.map((t) => {
    const m = state.mappings[t.key] || emptyMapping(t);
    return {
      key: t.key,
      name: t.name,
      aliases: t.aliases || [],
      protocolId: t.protocolId || m.protocolId || null,
      procedureCatalogId: m.procedureCatalogId || t.procedureCatalogId || null,
      procedureName: m.procedureName || null
    };
  });
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("settingsStatus").textContent = "Copied tracked JSON to clipboard.";
  } catch {
    $("settingsStatus").textContent = text;
  }
});

refreshMain("");
