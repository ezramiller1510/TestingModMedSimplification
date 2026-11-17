(function () {
  const saveVisitIdFromUrl = (url) => {
    if (typeof url !== "string") return;
    const match = url.match(/\/visits\/(\d+)/);
    if (match && match[1]) {
      document.documentElement.dataset.modmedVisitId = match[1];
    }
  };

  // 1. Intercept fetch()
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const reqUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;
    saveVisitIdFromUrl(reqUrl);
    return origFetch.apply(this, args);
  };

  // 2. Intercept XMLHttpRequest (AngularJS / Angular $http)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    saveVisitIdFromUrl(url);
    return origOpen.apply(this, [method, url, ...rest]);
  };
})();