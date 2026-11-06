const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listId = location.pathname.match(/^\/i\/lists\/(\d+)/)?.[1];
const members = new Map();
let firstPage = null;
let listName = null;

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "list-blocker") return;
  if (event.data.url.includes("/ListByRestId")) {
    listName = event.data.body?.data?.list?.name ?? listName;
    return;
  }
  const page = readPage(event.data.body);
  for (const user of page.users) members.set(user.id, user.handle);
  firstPage ??= { url: event.data.url, headers: event.data.headers, cursor: page.cursor };
});

if (listId && new URLSearchParams(location.search).has("autoblock")) run();

function readPage(body) {
  const users = [];
  let cursor = null;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.entryId === "string") {
      if (node.entryId.startsWith("user-")) {
        const user = node.content?.itemContent?.user_results?.result;
        const handle = user?.legacy?.screen_name ?? user?.core?.screen_name;
        if (user?.rest_id && handle) users.push({ id: user.rest_id, handle });
        return;
      }
      if (node.entryId.startsWith("cursor-bottom")) cursor = node.content?.value ?? null;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(body);
  return { users, cursor };
}

async function fetchRemainingPages(onProgress) {
  const seenCursors = new Set();
  let cursor = firstPage.cursor;
  while (cursor && !seenCursors.has(cursor)) {
    seenCursors.add(cursor);
    const url = new URL(firstPage.url, location.origin);
    const variables = JSON.parse(url.searchParams.get("variables"));
    url.searchParams.set("variables", JSON.stringify({ ...variables, cursor }));
    const response = await fetch(url, { headers: firstPage.headers, credentials: "include" });
    if (!response.ok) return `X refused the member request (HTTP ${response.status})`;
    const page = readPage(await response.json());
    if (page.users.length === 0) return null;
    for (const user of page.users) members.set(user.id, user.handle);
    onProgress(members.size);
    cursor = page.cursor;
    await sleep(500);
  }
  return null;
}

async function scrollRemainingPages(onProgress) {
  for (let idleRounds = 0; idleRounds < 8; ) {
    const before = members.size;
    [...document.querySelectorAll('[data-testid="UserCell"]')].at(-1)?.scrollIntoView({ block: "end" });
    await sleep(1000);
    onProgress(members.size);
    idleRounds = members.size === before ? idleRounds + 1 : 0;
  }
}

async function collectMembers(onProgress) {
  for (let waited = 0; !firstPage; waited += 500) {
    if (waited > 30000) return null;
    await sleep(500);
  }
  onProgress(members.size);
  const problem = await fetchRemainingPages(onProgress);
  if (problem && document.visibilityState === "visible") {
    await scrollRemainingPages(onProgress);
    return null;
  }
  return problem;
}

async function block(userId, csrf) {
  for (;;) {
    const response = await fetch("/i/api/1.1/blocks/create.json", {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: `Bearer ${BEARER}`,
        "x-csrf-token": csrf,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ user_id: userId, skip_status: "true" }),
    });
    if (response.status !== 429) return response.ok;
    const reset = Number(response.headers.get("x-rate-limit-reset")) * 1000;
    await sleep(Math.max(reset - Date.now(), 60_000));
  }
}

function createPanel() {
  const dark = isDarkPage();
  const panel = document.createElement("div");
  panel.setAttribute("role", "status");
  panel.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "width:288px",
    "padding:12px",
    "border-radius:10px",
    `background:${dark ? "#1f1f1f" : "#ffffff"}`,
    `border:1px solid ${dark ? "rgb(244 244 243 / 0.10)" : "rgb(5 5 5 / 0.10)"}`,
    `color:${dark ? "#f4f4f3" : "rgb(5 5 5 / 0.80)"}`,
    'font:400 13px/1.5 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    "-webkit-font-smoothing:antialiased",
  ].join(";");
  const title = document.createElement("div");
  title.textContent = "Slopblock";
  title.style.cssText = "font-weight:500;margin-bottom:2px";
  const text = document.createElement("div");
  text.style.color = dark ? "rgb(244 244 243 / 0.60)" : "rgb(5 5 5 / 0.60)";
  panel.append(title, text);
  document.body.append(panel);
  return (message) => (text.textContent = message);
}

function isDarkPage() {
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number);
  return r + g + b < 384;
}

async function saveRun(result) {
  const { runs, lists } = await chrome.storage.local.get({ runs: {}, lists: [] });
  await chrome.storage.local.set({
    runs: { ...runs, [listId]: { at: Date.now(), ...result } },
    lists: lists.map((list) => (list.id === listId && listName ? { ...list, name: listName } : list)),
  });
}

async function run() {
  const say = createPanel();
  const finish = async (summary, result) => {
    say(summary);
    await saveRun(result);
    chrome.runtime.sendMessage({ type: "finished" });
  };

  const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
  if (!csrf) return finish("Log in to X, then check again.", { error: "Not logged in to X" });

  const problem = await collectMembers((count) => say(`Reading members. ${count} found.`));
  if (members.size === 0) {
    return finish("Found no members. Check that the list exists and you can see it.", { error: "No members found" });
  }

  const { blockedIds } = await chrome.storage.local.get({ blockedIds: [] });
  const done = new Set(blockedIds);
  const pending = [...members].filter(([id]) => !done.has(id));

  const failed = [];
  for (const [index, [id, handle]] of pending.entries()) {
    say(`Blocking @${handle}, ${index + 1} of ${pending.length}.`);
    if (await block(id, csrf)) {
      done.add(id);
      await chrome.storage.local.set({ blockedIds: [...done] });
    } else {
      failed.push(handle);
    }
    await sleep(1000);
  }

  const blocked = pending.length - failed.length;
  await finish(`Blocked ${blocked} new accounts. ${members.size} members in this list.`, {
    members: members.size,
    blocked,
    failed: failed.length,
    ...(problem && { error: `Read only ${members.size} members. ${problem}` }),
  });
}
