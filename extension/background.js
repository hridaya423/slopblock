const DEFAULT_LISTS = [{ id: "2116659176894071283" }];
const CHECK_EVERY_MINUTES = 360;
const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;

const membersUrl = (listId) => `https://x.com/i/lists/${listId}/members?autoblock=1`;

async function check(listIds, visible) {
  const { runningTab, startedAt = 0, queue = [] } = await chrome.storage.session.get(["runningTab", "startedAt", "queue"]);
  const alive = runningTab ? await chrome.tabs.get(runningTab).then(() => true, () => false) : false;
  if (alive && !visible && Date.now() - startedAt < STUCK_AFTER_MS) {
    await chrome.storage.session.set({ queue: [...new Set([...queue, ...listIds])] });
    return;
  }
  if (alive) await chrome.tabs.remove(runningTab);
  const [first, ...rest] = listIds;
  if (!first) return chrome.storage.session.remove("runningTab");
  const tab = await chrome.tabs.create({ url: membersUrl(first), active: visible });
  await chrome.storage.session.set({ runningTab: tab.id, startedAt: Date.now(), queue: rest });
}

async function checkAll(visible) {
  const { lists } = await chrome.storage.local.get({ lists: DEFAULT_LISTS });
  await check(lists.map((list) => list.id), visible);
}

async function continueQueue(tab) {
  const { runningTab, queue = [] } = await chrome.storage.session.get(["runningTab", "queue"]);
  if (runningTab !== tab.id) return;
  const [next, ...rest] = queue;
  if (next) {
    await chrome.storage.session.set({ queue: rest });
    await chrome.tabs.update(tab.id, { url: membersUrl(next) });
    return;
  }
  await chrome.storage.session.remove("runningTab");
  if (!tab.active) await chrome.tabs.remove(tab.id);
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["lists", "auto"]);
  await chrome.storage.local.set({ lists: stored.lists ?? DEFAULT_LISTS, auto: stored.auto ?? true });
  chrome.alarms.create("check-lists", { periodInMinutes: CHECK_EVERY_MINUTES });
  if (stored.auto ?? true) checkAll(false);
});

chrome.alarms.onAlarm.addListener(async () => {
  const { auto } = await chrome.storage.local.get({ auto: true });
  if (auto) checkAll(false);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "check-all") checkAll(true);
  if (message.type === "check-list") check([message.listId], false);
  if (message.type === "finished" && sender.tab) continueQueue(sender.tab);
});
