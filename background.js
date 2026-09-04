// Content scripts cannot call chrome.runtime.openOptionsPage(), so they ask
// the service worker to open it on their behalf.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});
