"use strict";

const STYLE_ID = "github-ai-unslop-style";
const HIDDEN_ATTR = "data-unslop-hidden";

// Elements GitHub tags with stable Copilot markers. Kept narrow on purpose:
// GitHub also puts "copilot" on wrappers of regular features, e.g. the file
// view code sits in #copilot-button-positioner and the PR comment field has
// data-target="copilot-comment-mention-telemetry.…", so broad id, class or
// data-target matches would hide them.
const SELECTORS = [
  // Header button, chat panel, dashboard entrypoint and other React islands
  ".AppHeader-CopilotChat",
  "react-partial[partial-name*='copilot' i]",
  "[data-testid*='copilot' i]",
  "button[class*='copilot' i]",
  "a[class*='copilot' i]",
  "#copilot-code-review-limits-banner",
  "[class*='CopilotItems-module']",
  "button[aria-label*='Copilot']",
  "a[aria-label*='Copilot']",
  "[role='dialog'][aria-label*='Copilot']",
  "button[aria-label='Open agents panel']",

  // Icon-only buttons (e.g. the PR "Files changed" toolbar) carry nothing but
  // the Copilot, agent or Copilot Spaces octicon, so match the control that
  // wraps it. Repository tabs are left to COLLAPSED below.
  ":is(button, a:not([data-tab-item]), summary, [role='menuitem'], [role='option'], [role='tab']):has(svg:is(.octicon-copilot, .octicon-agent, .octicon-space))",
  "svg:is(.octicon-copilot, .octicon-agent, .octicon-space)",

  // "Agents" entry in the repository tab bar's "More" menu and the dashboard
  // "Agent sessions" list
  "li:has(> a[role='menuitem'][data-tab-item='agents'])",
  "react-partial[partial-name='dashboard-lists'] [class^='List__'] > div:has(a[href^='/copilot'])",

  // Pull request merge box sections such as "Copilot can watch this pull
  // request" with its "Watch and fix" button
  "[data-testid='mergebox-border-container'] > section:has(svg.octicon-copilot)",

  // Links to Copilot pages (chat, agents, spaces, marketing). Exact prefixes
  // so orgs like github.com/copilot-extensions stay visible.
  "a[href='/copilot']",
  "a[href^='/copilot/']",
  "a[href^='/copilot?']",
  "a[href='https://github.com/copilot']",
  "a[href^='https://github.com/copilot/']",
  "a[href^='https://github.com/copilot?']",
  "a[href*='/features/copilot']",
  "li:has(> a[href='/copilot'], > a[href^='/copilot/'], > a[href*='/features/copilot'])",
];

// The repository tab bar moves every tab it cannot see into a "More" menu,
// so a display:none tab makes an empty "More" button appear. These are
// shrunk to nothing in place instead, which the tab bar still counts as
// fitting, and taken out of the flex flow so they leave no gap.
const COLLAPSED = [
  "li:has(> a[data-tab-item='agents']:not([role='menuitem']))",
];

// Interactive elements whose visible label may mention Copilot without any
// stable attribute (e.g. "Assign to Copilot", "Ask Copilot").
const CANDIDATES = "button, summary, [role='menuitem'], [role='menuitemradio'], [role='option'], [role='tab']";

// Never touch text the user wrote or code being displayed.
const USER_CONTENT = [
  ".markdown-body",
  ".comment-body",
  ".js-comment-body",
  ".blob-code",
  ".react-code-text",
  ".react-file-line",
  "textarea",
  "[contenteditable='true']",
].join(", ");

// Capitalized product name as a whole word, so repo slugs such as
// "copilot-docs" or "github/copilot.vim" are left alone.
const COPILOT_LABEL = /(^|[^\w/.-])Copilot(?![\w/.-])/;
const MAX_LABEL_LENGTH = 60;

function buildStyle() {
  // One rule per selector: an invalid selector in a shared list would make
  // the browser drop the whole rule.
  const rules = SELECTORS.map(
    (selector) => `${selector}:not(:is(${USER_CONTENT}) *) { display: none !important; }`,
  );
  for (const selector of COLLAPSED) {
    rules.push(
      `${selector} { position: absolute !important; visibility: hidden !important; width: 0 !important;` +
        ` min-width: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }`,
    );
  }
  rules.push(`[${HIDDEN_ATTR}] { display: none !important; }`);

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = rules.join("\n");
  return style;
}

function setEnabled(enabled) {
  const existing = document.getElementById(STYLE_ID);
  if (enabled && !existing) {
    // Attached to <html> rather than <head> so Turbo's head merging and the
    // parser never move or drop it.
    document.documentElement.appendChild(buildStyle());
  } else if (!enabled && existing) {
    existing.remove();
  }
}

// <copilot-*> custom elements are not matched on purpose: GitHub wraps whole
// features in them, e.g. <copilot-comment-mention-telemetry> around the PR
// comment box.
function shouldHide(el) {
  if (!el.matches(CANDIDATES)) return false;
  if (el.closest(USER_CONTENT)) return false;
  const label = el.textContent.trim();
  return label.length > 0 && label.length <= MAX_LABEL_LENGTH && COPILOT_LABEL.test(label);
}

function hide(el) {
  el.setAttribute(HIDDEN_ATTR, "");
  // Menu entries are usually wrapped in an <li> that would leave a gap.
  const parent = el.parentElement;
  if (parent && parent.localName === "li" && parent.children.length === 1) {
    parent.setAttribute(HIDDEN_ATTR, "");
  }
}

function check(el) {
  if (!el.hasAttribute(HIDDEN_ATTR) && shouldHide(el)) hide(el);
}

function scan(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return;

  // A label often arrives after its button was inserted (streamed HTML,
  // React re-renders), so re-check the enclosing button too.
  const owner = element.closest(CANDIDATES);
  if (owner) check(owner);

  if (node !== element) return;
  check(element);
  for (const el of element.querySelectorAll(CANDIDATES)) check(el);
}

// GitHub navigates with Turbo and renders most UI with React, so new nodes
// keep arriving after load. Handling them inside the observer callback runs
// before the next paint, so hidden elements never flash on screen.
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      scan(mutation.target);
    } else {
      for (const node of mutation.addedNodes) scan(node);
    }
  }
});

// Hide immediately to avoid a flash, then honor the saved preference.
setEnabled(true);
observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
scan(document.documentElement);

browser.storage.local.get({ enabled: true }).then(({ enabled }) => setEnabled(enabled));

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "enabled" in changes) {
    setEnabled(changes.enabled.newValue !== false);
  }
});
