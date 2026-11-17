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
  const applyBtn = document.getElementById("applyBtn");
  const testBtn = document.getElementById("testBtn");
  applyBtn.disabled = busy;
  testBtn.disabled = busy;
  if (statusText != null) statusEl.textContent = statusText;
}

function formatCheckResult(response) {
  if (!response?.success) {
    return "Error: " + (response?.error || "Unknown error");
  }

  const matched = response.appliedIds || [];
  const missing = response.missingIds || [];
  const lines = [];

  if (response.visitId) lines.push(`Visit: ${response.visitId}`);

  if (matched.length) {
    lines.push(`Applied: ${matched.join(", ")}`);
  }
  if (missing.length) {
    lines.push(`Not applied: ${missing.join(", ")}`);
  }
  if (!matched.length && !missing.length) {
    lines.push("No protocol IDs were selected to check.");
  }

  if (Array.isArray(response.allAppliedIds)) {
    lines.push(
      response.allAppliedIds.length
        ? `All IDs on visit: ${response.allAppliedIds.join(", ")}`
        : "No protocol IDs found on this visit response."
    );
  }

  return lines.join("\n");
}

document.getElementById("testBtn").addEventListener("click", async () => {
  const protocols = gatherProtocols();
  if (protocols.length === 0) {
    setBusy(false, "Select or enter at least one protocol ID to test.");
    return;
  }

  setBusy(true, "Checking visit...");

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
