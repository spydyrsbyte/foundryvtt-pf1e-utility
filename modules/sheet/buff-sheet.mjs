const SETTING_KEY = "buffSheetTabOrder";
const NAV_SELECTOR = 'nav.sheet-navigation.tabs[data-group="primary"]';
const BODY_SELECTOR = "section.primary-body";

function resolveElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function getNativeTabs(el) {
  const nav = el.querySelector(NAV_SELECTOR);
  if (!nav) return [];
  return Array.from(nav.querySelectorAll("a.item[data-tab]")).map((el) => ({
    id: el.dataset.tab,
    label: el.textContent.trim(),
    native: true,
  }));
}

function getSetting() {
  const raw = game.settings.get("pf1e-util", SETTING_KEY);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return { order: [], hidden: [] };
}

function makeBinding(selector, store) {
  const binding = new Proxy(
    {},
    {
      get(_, event) {
        return (fn) => {
          store.push({ selector, event, fn });
          return binding;
        };
      },
    }
  );
  return binding;
}

function makeOn(store) {
  const on = (selector) => makeBinding(selector, store);
  on.id = (id) => makeBinding(`#${id}`, store);
  on.data = (attr, value) =>
    makeBinding(
      value !== undefined ? `[data-${attr}="${value}"]` : `[data-${attr}]`,
      store
    );
  return on;
}

function compileOrder(root, registrations) {
  const { order: savedOrder, hidden: savedHidden } = getSetting();
  const hiddenSet = new Set(savedHidden);
  const hasSavedOrder = savedOrder.length > 0;

  const nativeTabs = getNativeTabs(root);
  const allTabs = new Map();
  for (const tab of nativeTabs) allTabs.set(tab.id, tab);
  for (const [id, reg] of registrations) {
    if (!allTabs.has(id)) allTabs.set(id, { ...reg, native: false });
  }

  const order = [];

  if (hasSavedOrder) {
    const remaining = new Map(allTabs);
    for (const id of savedOrder) {
      if (remaining.has(id) && !hiddenSet.has(id)) {
        order.push(remaining.get(id));
        remaining.delete(id);
      }
    }
    for (const [, tab] of remaining) {
      if (!hiddenSet.has(tab.id)) order.push(tab);
    }
  } else {
    const usedIds = new Set();
    for (const tab of nativeTabs) {
      if (!hiddenSet.has(tab.id)) {
        order.push(tab);
        usedIds.add(tab.id);
      }
    }

    const injected = Array.from(registrations.values()).filter(
      (reg) => !hiddenSet.has(reg.id) && !usedIds.has(reg.id) && !reg.hidden
    );

    const byLabel = (a, b) => a.label.localeCompare(b.label);
    const withBefore = injected.filter((t) => t.order?.before).sort(byLabel);
    const withAfter = injected.filter((t) => t.order?.after).sort(byLabel);
    const withNumber = injected
      .filter((t) => typeof t.order === "number")
      .sort((a, b) => a.order - b.order || byLabel(a, b));
    const rest = injected
      .filter(
        (t) =>
          !t.order?.before && !t.order?.after && typeof t.order !== "number"
      )
      .sort(byLabel);

    for (const tab of withBefore) {
      const idx = order.findIndex((t) => t.id === tab.order.before);
      idx !== -1 ? order.splice(idx, 0, tab) : order.push(tab);
    }
    for (const tab of withAfter) {
      const idx = order.findIndex((t) => t.id === tab.order.after);
      idx !== -1 ? order.splice(idx + 1, 0, tab) : order.push(tab);
    }
    for (const tab of withNumber) {
      const idx = Math.min(tab.order, order.length);
      order.splice(idx, 0, tab);
    }
    for (const tab of rest) order.push(tab);
  }

  const hidden = Array.from(allTabs.values()).filter((tab) =>
    hiddenSet.has(tab.id) || (!hasSavedOrder && registrations.get(tab.id)?.hidden)
  );

  return { order, hidden };
}

const activeTabByApp = new Map();

async function applyOrder(app, html, registrations) {
  const root = resolveElement(html);
  if (!root) return;
  const nav = root.querySelector(NAV_SELECTOR);
  const body = root.querySelector(BODY_SELECTOR);
  if (!nav || !body) return;

  const item = app.document;
  const { order, hidden } = compileOrder(root, registrations);

  for (const tab of order) {
    if (tab.native) continue;
    const reg = registrations.get(tab.id);
    if (!reg || nav.querySelector(`a[data-tab="${tab.id}"]`)) continue;

    const context = reg.data ? await reg.data(item) : item;
    const htmlString = await renderTemplate(reg.template, context);
    if (!htmlString) continue;

    const navItem = document.createElement("a");
    navItem.className = "item";
    navItem.dataset.tab = tab.id;
    navItem.dataset.group = "primary";
    navItem.textContent = tab.label;
    nav.append(navItem);

    const pane = document.createElement("div");
    pane.className = `tab ${tab.id} flexcol`;
    pane.dataset.group = "primary";
    pane.dataset.tab = tab.id;
    pane.innerHTML = htmlString;
    body.append(pane);

    for (const { selector, event, fn } of reg.bindings) {
      pane.addEventListener(event, (e) => {
        if (e.target.closest(selector)) fn(e, item);
      });
    }
  }

  for (const tab of hidden) {
    nav.querySelector(`a[data-tab="${tab.id}"]`)?.remove();
    body.querySelector(`div.tab[data-tab="${tab.id}"]`)?.remove();
  }

  for (const tab of order) {
    const navItem = nav.querySelector(`a[data-tab="${tab.id}"]`);
    if (navItem) nav.append(navItem);
    const pane = body.querySelector(`div.tab[data-tab="${tab.id}"]`);
    if (pane) body.append(pane);
  }

  const lastTab = activeTabByApp.get(app.appId);
  if (lastTab && nav.querySelector(`a[data-tab="${lastTab}"]`)) {
    app._tabs?.[0]?.activate(lastTab);
  }

  nav.querySelectorAll("a.item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => activeTabByApp.set(app.appId, item.dataset.tab));
  });

  return { order, hidden };
}

export class BuffSheetRegistry {
  #registrations = new Map();
  #lastKnownOrder = { order: [], hidden: [] };
  #onNextOrderUpdate = null;

  tabs = {
    /**
     * Register a new tab for injection into buff item sheets.
     * @param {object} config
     * @param {string} [config.id]        - Tab id. Auto-derived from label slug if omitted.
     * @param {string} config.label       - Display label shown in the tab nav.
     * @param {string} config.template    - Path to the Handlebars template.
     * @param {Function} [config.data]    - Optional async fn(item) returning template context.
     *                                      Defaults to passing the item directly as context.
     * @param {number|{before:string}|{after:string}} [config.order] - Default position.
     * @param {boolean} [config.hidden=false] - If true, hidden by default until user enables it.
     * @returns {{ on: Function }} Tab instance for attaching event listeners.
     */
    new: ({ id, label, template, data, order, hidden = false } = {}) => {
      const bindings = [];
      const reg = { label, template, data, order, hidden, bindings };
      Object.defineProperty(reg, "id", { value: id ?? slugify(label), writable: false, enumerable: true });
      this.#registrations.set(reg.id, reg);
      reg.on = makeOn(bindings);
      return reg;
    },
  };

  initialize() {
    game.settings.register("pf1e-util", SETTING_KEY, {
      scope: "client",
      config: false,
      type: Object,
      default: { order: [], hidden: [] },
    });

    Hooks.on("renderItemSheetPF", (app, html) => {
      if (app.document?.type !== "buff") return;
      void applyOrder(app, html, this.#registrations).then((result) => {
        if (result) {
          this.#lastKnownOrder = result;
          this.#onNextOrderUpdate?.();
          this.#onNextOrderUpdate = null;
        }
      });
    });

    Hooks.on("closeItemSheetPF", (app) => {
      if (app.document?.type !== "buff") return;
      activeTabByApp.delete(app.appId);
    });
  }

  getOrder() {
    return { ...this.#lastKnownOrder };
  }

  saveOrder(order, hidden) {
    game.settings.set("pf1e-util", SETTING_KEY, { order, hidden });
  }

  clearOrder(callback) {
    if (callback) this.#onNextOrderUpdate = callback;
    game.settings.set("pf1e-util", SETTING_KEY, { order: [], hidden: [] });
  }
}
