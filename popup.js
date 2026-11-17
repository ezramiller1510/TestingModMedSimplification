const BUTTON_IDS = ["addBtn", "collectBtn", "checkBtn", "copyBtn", "applyMappedBtn"];

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

async function loadState() {
  const stored = await chrome.storage.local.get(["trackedProtocols", "protocolMappings"]);
  return {
    tracked: Array.isArray(stored.trackedProtocols) ? stored.trackedProtocols : [],
    mappings: stored.protocolMappings || {}
  };
}

function renderTargets(tracked, mappings) {
  const list = document.getElementById("targetList");
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
      ${
        (target.aliases || []).length
          ? `<br><span class="muted">aliases: ${target.aliases.join(", ")}</span>`
          : ""
      }
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
      await refreshUi(`Removed tracked test.`);
    });
  });
}

function formatCollectResult(response) {
  if (!response?.success) return "Error: " + (response?.error || "Unknown error");

  const lines = [
    `Visit: ${response.visitId}`,
    `Overview source: ${response.overviewSource}`,
    `Captured calls: ${response.captureCount}`,
    "",
    "Tracked mappings:"
  ];

  (response.mappings || []).forEach((m) => {
    lines.push(
      `- ${m.name}: protocolId=${m.protocolId || "?"} procedureCatalogId=${m.procedureCatalogId || "?"} (${m.procedureName || m.procedureAlias || "—"})`
    );
  });

  if (response.note) lines.push("", response.note);
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
  const { tracked, mappings } = await loadState();
  renderTargets(tracked, mappings);
  if (statusText != null) document.getElementById("status").textContent = statusText;
}

document.getElementById("addBtn").addEventListener("click", async () => {
  try {
    const name = document.getElementById("newName").value;
    const protocolId = document.getElementById("newProtocolId").value;
    const aliases = document.getElementById("newAliases").value;
    const procedureCatalogId = document.getElementById("newProcedureId").value;

    const item = createTrackedProtocol({ name, protocolId, aliases, procedureCatalogId });
    const { tracked, mappings } = await loadState();

    // Replace existing same-name entry to avoid duplicates.
    const filtered = tracked.filter(
      (t) => normalizeLabel(t.name) !== normalizeLabel(item.name)
    );
    filtered.push(item);

    const mappingsNext = { ...mappings };
    // Drop old same-name keys
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

    document.getElementById("newName").value = "";
    document.getElementById("newProtocolId").value = "";
    document.getElementById("newAliases").value = "";
    document.getElementById("newProcedureId").value = "";

    await refreshUi(`Tracking “${item.name}”.`);
  } catch (err) {
    document.getElementById("status").textContent = err.message;
  }
});

document.getElementById("collectBtn").addEventListener("click", async () => {
  setBusy(true, "Collecting procedure IDs for your tracked tests...");
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
  setBusy(true, "Checking visit for tracked procedure IDs...");
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
  const { tracked, mappings } = await loadState();
  const payload = tracked.map((t) => {
    const m = mappings[t.key] || emptyMapping(t);
    return {
      key: t.key,
      name: t.name,
      aliases: t.aliases || [],
      protocolId: t.protocolId || m.protocolId || null,
      procedureCatalogId: m.procedureCatalogId || t.procedureCatalogId || null,
      procedureName: m.procedureName || null,
      procedureAlias: m.procedureAlias || null
    };
  });
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("status").textContent = "Copied tracked JSON to clipboard.";
  } catch {
    document.getElementById("status").textContent = text;
  }
});

document.getElementById("applyMappedBtn").addEventListener("click", async () => {
  const { tracked, mappings } = await loadState();
  const uniqueIds = [
    ...new Set(
      tracked
        .map((t) => t.protocolId || mappings[t.key]?.protocolId)
        .filter(Boolean)
        .map(String)
    )
  ];

  if (!uniqueIds.length) {
    document.getElementById("status").textContent =
      "No protocolIds on tracked tests yet. Add protocol IDs above first.";
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

refreshUi("");
