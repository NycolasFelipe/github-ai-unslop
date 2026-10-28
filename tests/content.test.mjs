// Runs content.js in a real Firefox against tests/fixtures/github.html.
//
// The script is registered as a preload script, so like the extension's
// document_start content script it runs before the page is parsed. A small
// in-memory stand-in replaces browser.storage.
//
// Firefox is taken from $FIREFOX_BIN, falling back to `firefox` on PATH.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const CONTENT_JS = readFileSync(fileURLToPath(new URL("../content.js", import.meta.url)), "utf8");
const FIXTURE_URL = pathToFileURL(fileURLToPath(new URL("./fixtures/github.html", import.meta.url))).href;
const FIREFOX = process.env.FIREFOX_BIN || execFileSync("which", ["firefox"], { encoding: "utf8" }).trim();

function storageShim(initial) {
  return `
    (() => {
      let store = ${JSON.stringify(initial)};
      const listeners = [];
      window.browser = {
        storage: {
          local: {
            get: async (defaults) => ({ ...defaults, ...store }),
            set: async (values) => {
              const changes = {};
              for (const [key, value] of Object.entries(values)) changes[key] = { oldValue: store[key], newValue: value };
              store = { ...store, ...values };
              for (const listener of listeners) listener(changes, "local");
            },
          },
          onChanged: { addListener: (listener) => listeners.push(listener) },
        },
      };
    })();
  `;
}

let browser;

async function openFixture({ storage = {} } = {}) {
  const page = await browser.newPage();
  // Preload scripts run before <html> exists, while Firefox runs
  // document_start content scripts right after it is created. Wait for it.
  await page.evaluateOnNewDocument(`
    ${storageShim(storage)}
    (() => {
      const run = () => { ${CONTENT_JS} };
      if (document.documentElement) return run();
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        observer.disconnect();
        run();
      }).observe(document, { childList: true });
    })();
  `);
  await page.goto(FIXTURE_URL, { waitUntil: "load" });
  // Let the async storage read settle.
  await settle(page);
  return page;
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));

const isVisible = (page, id) =>
  page.evaluate((id) => document.getElementById(id).checkVisibility({ visibilityProperty: true }), id);

const expected = (page, state) =>
  page.evaluate((state) => [...document.querySelectorAll(`[data-expect="${state}"]`)].map((el) => el.id), state);

async function wrongVisibility(page, state) {
  const shouldBeVisible = state === "visible";
  const wrong = [];
  for (const id of await expected(page, state)) {
    if ((await isVisible(page, id)) !== shouldBeVisible) wrong.push(id);
  }
  return wrong;
}

before(async () => {
  browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
});

after(async () => {
  await browser?.close();
});

describe("initial page", () => {
  it("hides every Copilot element", async () => {
    const page = await openFixture();
    assert.deepEqual(await wrongVisibility(page, "hidden"), []);
    await page.close();
  });

  it("keeps everything else visible", async () => {
    const page = await openFixture();
    assert.deepEqual(await wrongVisibility(page, "visible"), []);
    await page.close();
  });

  it("hides elements before page scripts run", async () => {
    const page = await openFixture();
    assert.deepEqual(await page.evaluate(() => window.__hiddenDuringParse), [true, true]);
    await page.close();
  });

  // The tab bar moves tabs that are not rendered into its "More" menu, so a
  // display:none Agents tab brings up an empty "More" button.
  it("collapses the Agents tab in place instead of removing it", async () => {
    const page = await openFixture();
    const tab = await page.evaluate(() => {
      const li = document.getElementById("nav-agents-item");
      const style = getComputedStyle(li);
      return {
        display: style.display,
        position: style.position,
        width: li.getBoundingClientRect().width,
        anchorDisplay: getComputedStyle(li.firstElementChild).display,
      };
    });
    assert.notEqual(tab.display, "none");
    assert.notEqual(tab.anchorDisplay, "none");
    assert.equal(tab.position, "absolute");
    assert.equal(tab.width, 0);
    await page.close();
  });

  it("produces only CSS rules Firefox accepts", async () => {
    const page = await openFixture();
    const { written, parsed } = await page.evaluate(() => {
      const style = document.getElementById("github-ai-unslop-style");
      return { written: style.textContent.trim().split("\n").length, parsed: style.sheet.cssRules.length };
    });
    assert.equal(parsed, written);
    await page.close();
  });
});

describe("content added later", () => {
  it("hides a button whose label arrives after it was inserted", async () => {
    const page = await openFixture();
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "late";
      document.body.append(button);
    });
    await settle(page);
    await page.evaluate(() => {
      const label = document.createElement("span");
      label.textContent = "Ask Copilot";
      document.getElementById("late").append(label);
    });
    await settle(page);
    assert.equal(await isVisible(page, "late"), false);
    await page.close();
  });

  it("hides a button whose text is edited in place", async () => {
    const page = await openFixture();
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "edited";
      button.textContent = "Loading";
      document.body.append(button);
    });
    await settle(page);
    await page.evaluate(() => {
      document.getElementById("edited").firstChild.data = "Open Copilot";
    });
    await settle(page);
    assert.equal(await isVisible(page, "edited"), false);
    await page.close();
  });

  it("handles a Turbo-style body replacement", async () => {
    const page = await openFixture();
    await page.evaluate(() => {
      const body = document.createElement("body");
      body.innerHTML = `
        <button id="turbo-copilot">Assign to Copilot</button>
        <button id="turbo-icon"><svg class="octicon octicon-copilot" width="16" height="16"></svg></button>
        <button id="turbo-plain">Assign to me</button>`;
      document.body.replaceWith(body);
    });
    await settle(page);
    assert.equal(await isVisible(page, "turbo-copilot"), false);
    assert.equal(await isVisible(page, "turbo-icon"), false);
    assert.equal(await isVisible(page, "turbo-plain"), true);
    await page.close();
  });
});

describe("on/off switch", () => {
  it("shows everything when turned off and hides it again when turned on", async () => {
    const page = await openFixture();

    await page.evaluate(() => browser.storage.local.set({ enabled: false }));
    await settle(page);
    assert.deepEqual(await wrongVisibility(page, "visible"), []);
    const stillHidden = [];
    for (const id of await expected(page, "hidden")) {
      if (!(await isVisible(page, id))) stillHidden.push(id);
    }
    assert.deepEqual(stillHidden, []);

    await page.evaluate(() => browser.storage.local.set({ enabled: true }));
    await settle(page);
    assert.deepEqual(await wrongVisibility(page, "hidden"), []);
    await page.close();
  });

  it("respects a saved off state on page load", async () => {
    const page = await openFixture({ storage: { enabled: false } });
    assert.equal(await isVisible(page, "assign-copilot"), true);
    assert.equal(await isVisible(page, "header-copilot-group"), true);
    await page.close();
  });

  it("keeps hiding when the setting is removed", async () => {
    const page = await openFixture();
    await page.evaluate(() => browser.storage.local.set({ enabled: undefined }));
    await settle(page);
    assert.equal(await isVisible(page, "assign-copilot"), false);
    await page.close();
  });
});
