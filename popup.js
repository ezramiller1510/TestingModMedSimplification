document.getElementById("applyBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("status");
  const btn = document.getElementById("applyBtn");

  // 1. Gather checked boxes
  const checkedIds = Array.from(document.querySelectorAll('input[name="protocol"]:checked'))
    .map(cb => cb.value.trim());

  // 2. Gather any comma-separated IDs typed into the text box
  const customRaw = document.getElementById("customId").value.trim();
  const customIds = customRaw
    ? customRaw.split(",").map(id => id.trim()).filter(Boolean)
    : [];

  // Combine and deduplicate
  const protocolIds = [...new Set([...checkedIds, ...customIds])];

  if (protocolIds.length === 0) {
    statusEl.textContent = "Select or enter at least one protocol ID.";
    return;
  }

  btn.disabled = true;
  statusEl.textContent = "Applying...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("modmedapp.com")) {
      throw new Error("Open a ModMed tab first.");
    }

    chrome.tabs.sendMessage(tab.id, { action: "APPLY_PROTOCOLS", protocolIds }, (response) => {
      btn.disabled = false;

      if (chrome.runtime.lastError) {
        statusEl.textContent = "Connection failed—try refreshing the ModMed tab.";
        return;
      }

      if (response?.success) {
        statusEl.textContent = "Applied! Reloading page...";
        setTimeout(() => window.close(), 600);
      } else {
        statusEl.textContent = "Error: " + (response?.error || "Unknown error");
      }
    });
  } catch (err) {
    btn.disabled = false;
    statusEl.textContent = err.message;
  }
});