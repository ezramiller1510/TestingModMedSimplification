(function () {
  const STORAGE_KEY = "modmedNetCapture";
  const MAX_ENTRIES = 120;
  const MAX_BODY = 80000;

  const INTERESTING =
    /\/ema\/ws\/|\/ema\/fhir\/|protocol|special|test|order|diagnos|optic|interpret|procedure|plan|visit/i;

  const saveVisitIdFromUrl = (url) => {
    if (typeof url !== "string") return;
    const match = url.match(/\/visits\/(\d+)/);
    if (match && match[1]) {
      document.documentElement.dataset.modmedVisitId = match[1];
    }
  };

  const readLog = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const writeLog = (entries) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
      document.documentElement.dataset.modmedCaptureCount = String(entries.length);
    } catch {
      // Quota or private mode — keep going without persistence.
    }
  };

  const pushEntry = (entry) => {
    const entries = readLog();
    entries.push(entry);
    writeLog(entries);
    window.dispatchEvent(
      new CustomEvent("modmed-net-capture", {
        detail: { count: entries.length, lastUrl: entry.url }
      })
    );
  };

  const shouldCapture = (url) => typeof url === "string" && INTERESTING.test(url);

  const captureResponse = async (method, url, status, bodyText) => {
    if (!shouldCapture(url)) return;
    pushEntry({
      ts: Date.now(),
      method,
      url,
      status,
      body: typeof bodyText === "string" ? bodyText.slice(0, MAX_BODY) : ""
    });
  };

  // 1. Intercept fetch()
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const req = args[0];
    const reqUrl = typeof req === "string" ? req : req?.url;
    const method =
      (args[1] && args[1].method) ||
      (typeof req !== "string" && req?.method) ||
      "GET";

    saveVisitIdFromUrl(reqUrl);

    return origFetch.apply(this, args).then((res) => {
      if (shouldCapture(reqUrl)) {
        res
          .clone()
          .text()
          .then((text) => captureResponse(String(method).toUpperCase(), reqUrl, res.status, text))
          .catch(() => {});
      }
      return res;
    });
  };

  // 2. Intercept XMLHttpRequest (AngularJS / Angular $http)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__modmedMethod = method;
    this.__modmedUrl = url;
    saveVisitIdFromUrl(url);
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (shouldCapture(this.__modmedUrl)) {
      this.addEventListener("load", () => {
        captureResponse(
          String(this.__modmedMethod || "GET").toUpperCase(),
          this.__modmedUrl,
          this.status,
          this.responseText || ""
        );
      });
    }
    return origSend.apply(this, args);
  };

  // Expose a tiny debug helper in the page console.
  window.__modmedCapture = {
    list: () => readLog(),
    clear: () => writeLog([]),
    find: (needle) => {
      const n = String(needle || "").trim();
      if (!n) return [];
      const re = new RegExp(`(^|[^0-9A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Za-z]|$)`, "i");
      return readLog().filter((e) => re.test(e.url) || re.test(e.body || ""));
    }
  };
})();
