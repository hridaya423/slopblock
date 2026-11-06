const ICONS = {
  ok: "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
  failed: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z",
  waiting: "M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z",
  remove: "M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z",
};

const listsEl = document.getElementById("lists");
const emptyEl = document.getElementById("empty");
const urlInput = document.getElementById("url");
const autoSwitch = document.getElementById("auto");
const count = new Intl.NumberFormat("en");

const dark = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => (document.body.dataset.theme = dark.matches ? "dark" : "light");
applyTheme();
dark.addEventListener("change", applyTheme);

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function ago(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function describe(run) {
  if (!run) return { state: "waiting", text: "Not checked yet" };
  if (run.error) return { state: "failed", text: `${run.error}, ${ago(run.at)}` };
  return {
    state: "ok",
    text: `${count.format(run.blocked)} new blocks of ${count.format(run.members)}, ${ago(run.at)}`,
  };
}

function renderList(list, run) {
  const row = document.createElement("li");
  row.className = "row";

  const main = document.createElement("div");
  main.className = "row-main";
  const name = document.createElement("a");
  name.className = "row-name type-label";
  name.href = `https://x.com/i/lists/${list.id}`;
  name.target = "_blank";
  if (list.name) {
    name.textContent = list.name;
  } else {
    name.classList.add("mono");
    name.textContent = list.id;
  }

  const { state, text } = describe(run);
  const meta = document.createElement("p");
  meta.className = "row-meta type-caption";
  meta.dataset.state = state;
  const metaText = document.createElement("span");
  metaText.textContent = text;
  meta.append(icon(state), metaText);
  main.append(name, meta);

  const remove = document.createElement("button");
  remove.className = "btn icon ghost";
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${list.name ?? `list ${list.id}`}`);
  remove.append(icon("remove"));
  remove.addEventListener("click", async () => {
    const { lists } = await chrome.storage.local.get({ lists: [] });
    await chrome.storage.local.set({ lists: lists.filter((item) => item.id !== list.id) });
  });

  row.append(main, remove);
  return row;
}

async function render() {
  const { lists, runs, blockedIds, auto } = await chrome.storage.local.get({
    lists: [],
    runs: {},
    blockedIds: [],
    auto: true,
  });
  listsEl.replaceChildren(...lists.map((list) => renderList(list, runs[list.id])));
  emptyEl.hidden = lists.length > 0;
  document.getElementById("run").disabled = lists.length === 0;
  document.getElementById("total").textContent = blockedIds.length
    ? `${count.format(blockedIds.length)} accounts blocked so far`
    : "No accounts blocked yet";
  autoSwitch.setAttribute("aria-checked", String(auto));
  document.getElementById("schedule").textContent = auto
    ? "Checks every 6 hours"
    : "Auto-check is off";
}

document.getElementById("add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = urlInput.value.match(/lists\/(\d+)/)?.[1] ?? urlInput.value.trim().match(/^\d{5,}$/)?.[0];
  if (!id) {
    urlInput.setAttribute("aria-invalid", "true");
    urlInput.focus();
    return;
  }
  urlInput.removeAttribute("aria-invalid");
  urlInput.value = "";
  const { lists } = await chrome.storage.local.get({ lists: [] });
  if (lists.some((list) => list.id === id)) return;
  await chrome.storage.local.set({ lists: [...lists, { id }] });
  chrome.runtime.sendMessage({ type: "check-list", listId: id });
});

urlInput.addEventListener("input", () => urlInput.removeAttribute("aria-invalid"));

autoSwitch.addEventListener("click", async () => {
  await chrome.storage.local.set({ auto: autoSwitch.getAttribute("aria-checked") !== "true" });
});

document.getElementById("run").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "check-all" });
  window.close();
});

chrome.storage.onChanged.addListener(render);
render();
