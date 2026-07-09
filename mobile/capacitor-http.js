(function () {
  const queueTimesOrigin = "https://queue-times.com";
  const originalFetch = window.fetch.bind(window);

  function capacitorHttp() {
    return window.Capacitor?.Plugins?.CapacitorHttp;
  }

  function isNativeAvailable() {
    return Boolean(
      window.Capacitor?.isNativePlatform?.() &&
      capacitorHttp()?.request
    );
  }

  function requestUrl(input) {
    return new URL(typeof input === "string" ? input : input.url, window.location.href);
  }

  function headersToObject(headers) {
    if (!headers) return {};
    if (headers instanceof Headers) return Object.fromEntries(headers.entries());
    if (Array.isArray(headers)) return Object.fromEntries(headers);
    return headers;
  }

  function isQueueTimesRequest(input) {
    try {
      return requestUrl(input).origin === queueTimesOrigin;
    } catch {
      return false;
    }
  }

  async function nativeFetch(input, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const response = await capacitorHttp().request({
      method,
      url: requestUrl(input).href,
      headers: headersToObject(init.headers),
      data: init.body,
      responseType: "text"
    });
    const data = typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data ?? "");

    return new Response(data, {
      status: response.status || 200,
      headers: response.headers || {}
    });
  }

  window.QueuePanelNativeFetch = {
    isNativeAvailable,
    fetch: nativeFetch
  };

  window.fetch = (input, init = {}) => {
    if (isNativeAvailable() && isQueueTimesRequest(input)) {
      return nativeFetch(input, init);
    }

    return originalFetch(input, init);
  };
})();
