const publish = (url, headers, body) =>
  window.postMessage({ source: "list-blocker", url, headers, body }, location.origin);

const isMembersRequest = (url) => /\/(ListMembers|ListByRestId)\b/.test(url);

const originalOpen = XMLHttpRequest.prototype.open;
const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  const requestUrl = String(url);
  if (isMembersRequest(requestUrl)) {
    this.listBlockerHeaders = {};
    this.addEventListener("load", () => {
      try {
        const body = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
        publish(requestUrl, this.listBlockerHeaders, body);
      } catch {}
    });
  }
  return originalOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (this.listBlockerHeaders) this.listBlockerHeaders[name] = value;
  return originalSetRequestHeader.call(this, name, value);
};

const originalFetch = window.fetch;
window.fetch = async function (input, init) {
  const response = await originalFetch.call(this, input, init);
  const url = String(input instanceof Request ? input.url : input);
  if (isMembersRequest(url)) {
    const headers = Object.fromEntries(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
    response.clone().json().then((body) => publish(url, headers, body), () => {});
  }
  return response;
};
