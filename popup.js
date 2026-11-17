function gatherProtocols() {
  const checked = Array.from(document.querySelectorAll('input[name="protocol"]:checked')).map((cb) => ({
    id: cb.value.trim(),
    name: cb.dataset.name || cb.parentElement?.textContent?.trim() || cb.value.trim()
  }));

  const customRaw = document.getElementById("customId").value.trim();
  const custom = customRaw
    ? customRaw.split(",").map((id) => id.trim()).filter(Boolean).map((id) => ({ id, name: id }))
    : [];

  const byId = new Map();
  [...checked, ...custom].forEach((p) => {
    if (p.id) byId.set(p.id, p);
  });
  return [...byId.values()];
}

async function getActiveModMedTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("modmedapp.com")) {
    throw new Error("Open a ModMed tab first.");
  }
  return tab;
}

function setBusy(busy, statusText) {
  const statusEl = document.getElementById("status");
  ["applyBtn", "testBtn", "captureBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = busy;
  });
  if (statusText != null) statusEl.textContent = statusText;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function formatCheckResult(response) {
  if (!response?.success) {
    return "Error: " + (response?.error || "Unknown error");
  }

  const lines = [];
  if (response.visitId) lines.push(`Visit: ${response.visitId}`);
  lines.push(`Captured calls so far: ${response.captureCount ?? 0}`);

  const matched = response.appliedIds || [];
  const missing = response.missingIds || [];

  if (matched.length) lines.push(`Found IDs: ${matched.join(", ")}`);
  if (missing.length) lines.push(`Not found yet: ${missing.join(", ")}`);

  const hits = response.hits || [];
  if (hits.length) {
    lines.push("", "Hits:");
    hits.slice(0, 12).forEach((h, i) => {
      lines.push(`${i + 1}. [${h.method} ${h.status}] ${h.where}`);
      lines.push(`   ${shortUrl(h.url)}`);
      if (h.snippet) lines.push(`   …${h.snippet}…`);
    });
  }

  const readable = response.readableEndpoints || [];
  if (!hits.length && readable.length) {
    lines.push("", "Endpoints that returned data (no ID match):");
    readable.slice(0, 8).forEach((e) => lines.push(`- ${shortUrl(e.url)}`));
  }

  if (response.note) {
    lines.push("", response.note);
  }

  return lines.join("\n");
}

function formatCaptureSummary(response) {
  if (!response?.success) {
    return "Error: " + (response?.error || "Unknown error");
  }

  const lines = [`Captured ${response.count} API call(s).`];
  (response.recent || []).forEach((e, i) => {
    lines.push(`${i + 1}. [${e.method} ${e.status}] ${shortUrl(e.url)}`);
  });

  if (!response.count) {
    lines.push(
      "",
      "Nothing captured yet. Keep this ModMed tab open, click around Special Testing / Protocols / the visit note, then reopen this popup."
    );
  } else {
    lines.push("", "Tip: select an ID and click Test — it searches these captured bodies for that ID.");
  }

  return lines.join("\n");
}

document.getElementById("testBtn").addEventListener("click", async () => {
  const protocols = gatherProtocols();
  if (protocols.length === 0) {
    setBusy(false, "Select or enter at least one protocol ID to test.");
    return;
  }

  setBusy(true, "Probing endpoints + searching captured traffic...");

  try {
    const tab = await getActiveModMedTab();

    chrome.tabs.sendMessage(tab.id, { action: "CHECK_APPLIED_PROTOCOLS", protocols }, (response) => {
      setBusy(false);

      if (chrome.runtime.lastError) {
        document.getElementById("status").textContent =
          "Connection failed—try refreshing the ModMed tab.";
        return;
      }

      document.getElementById("status").textContent = formatCheckResult(response);
    });
  } catch (err) {
    setBusy(false, err.message);
  }
});

document.getElementById("captureBtn").addEventListener("click", async () => {
  setBusy(true, "Reading capture log...");

  try {
    const tab = await getActiveModMedTab();

    chrome.tabs.sendMessage(tab.id, { action: "GET_CAPTURE_SUMMARY" }, (response) => {
      setBusy(false);

      if (chrome.runtime.lastError) {
        document.getElementById("status").textContent =
          "Connection failed—try refreshing the ModMed tab.";
        return;
      }

      document.getElementById("status").textContent = formatCaptureSummary(response);
    });
  } catch (err) {
    setBusy(false, err.message);
  }
});

document.getElementById("applyBtn").addEventListener("click", async () => {
  const protocols = gatherProtocols();
  const protocolIds = protocols.map((p) => p.id);

  if (protocolIds.length === 0) {
    setBusy(false, "Select or enter at least one protocol ID.");
    return;
  }

  setBusy(true, "Applying...");

  try {
    const tab = await getActiveModMedTab();

    chrome.tabs.sendMessage(tab.id, { action: "APPLY_PROTOCOLS", protocolIds }, (response) => {
      setBusy(false);

      if (chrome.runtime.lastError) {
        document.getElementById("status").textContent =
          "Connection failed—try refreshing the ModMed tab.";
        return;
      }

      if (response?.success) {
        document.getElementById("status").textContent = "Applied! Reloading page...";
        setTimeout(() => window.close(), 600);
      } else {
        document.getElementById("status").textContent =
          "Error: " + (response?.error || "Unknown error");
      }
    });
  } catch (err) {
    setBusy(false, err.message);
  }
});
