const DEFAULT_SETTINGS = {
  autoSend: false
};

async function load() {
  const { settings } = await chrome.storage.local.get("settings");
  const value = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  document.querySelector("#autoSend").checked = !!value.autoSend;
}

async function save() {
  const current = await chrome.storage.local.get("settings");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(current.settings || {}),
    autoSend: document.querySelector("#autoSend").checked
  };

  await chrome.storage.local.set({ settings });

  const saved = document.querySelector("#saved");
  saved.textContent = "保存しました";
  setTimeout(() => saved.textContent = "", 1200);
}

document.querySelector("#autoSend").addEventListener("change", save);
load();
