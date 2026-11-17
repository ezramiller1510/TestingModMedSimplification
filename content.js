chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "CHECK_APPLIED_PROTOCOLS") {
    fetchAppliedProtocolNames()
      .then(activeNames => {
        console.log("ModMed API returned diagnoses:", activeNames); // <--- CHECK F12 CONSOLE
        const activeSet = new Set(activeNames.map(n => n.toLowerCase()));
        
        const matchedIds = message.protocols
          .filter(p => {
            const hasMatch = p.name && activeSet.has(p.name.toLowerCase());
            console.log(`Comparing protocol "${p.name}" -> Match? ${hasMatch}`);
            return hasMatch;
          })
          .map(p => p.id);

        sendResponse({ appliedIds: matchedIds });
      })
      .catch(err => {
        console.log("Error checking applied protocols:", err.message);
        sendResponse({ appliedIds: [] });
      });
    return true;
  }
  // ... (keep your APPLY_PROTOCOLS handler below)
});

function getActiveVisitId() {
  // 1. Check the ID captured by interceptor.js
  if (document.documentElement.dataset.modmedVisitId) {
    return document.documentElement.dataset.modmedVisitId;
  }

  // 2. Fallback: check the browser URL
  const urlMatch = window.location.href.match(/visits\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  return null;
}

async function applyProtocolsToVisit(protocolIds) {
  const visitId = getActiveVisitId();
  if (!visitId) {
    throw new Error("Could not detect Visit ID. Try clicking into the visit note or refreshing the page.");
  }

  const xsrf = document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1];
  const url = `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}/protocols?orderVersion=0&selector=ordersSent,hasSendableLabOrderRequest`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {})
    },
    body: JSON.stringify(protocolIds)
  });

  if (!res.ok) throw new Error(`ModMed API returned ${res.status}`);

  window.location.reload();
}


async function fetchAppliedProtocolNames() {
  const visitId = getActiveVisitId();
  if (!visitId) return [];

  const xsrf = document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1];
  const url = `https://rep.modmedapp.com/ema/ws/v3/visits/${visitId}?selector=diagnoses(diagnosisName)`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {})
    }
  });

  if (!res.ok) throw new Error(`API returned ${res.status}`);

  const data = await res.json();
  const diagnoses = data.diagnoses || data.visit?.diagnoses || [];
  return diagnoses.map(d => d.diagnosisName).filter(Boolean);
}