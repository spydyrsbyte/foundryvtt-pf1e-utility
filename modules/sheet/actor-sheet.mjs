const SETTINGS_KEY = "actorSheetTabSettings";
const NAV_SELECTOR  = 'nav.sheet-navigation.tabs[data-group="primary"]';
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

function getTabSettings() {
  try {
    const raw = game.settings.get("pf1e-util", SETTINGS_KEY);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch { /* not yet registered */ }
  return { nativeOrder: [], tabs: {} };
}

/**
 * Ensures the settings object is fully populated for all known tabs.
 * Called on every render; only writes back if something changed.
 *
 * Settings shape:
 * {
 *   nativeOrder: [id, ...],          // native tab ids in their original order
 *   tabs: {
 *     [labelKey]: {
 *       label:        string,         // display label
 *       hidden:       boolean,
 *       order:        number,         // sort position
 *       currentIndex: number,         // which override is active
 *       overrides:    [id, ...]       // native id at [0], then registered sorted by id
 *     }
 *   }
 * }
 */
function ensureTabSettings(settings, nativeTabs, allTabs) {
  let changed = false;
  const result = {
    nativeOrder: [...(settings.nativeOrder ?? [])],
    tabs: Object.fromEntries(
      Object.entries(settings.tabs ?? {}).map(([k, v]) => [k, { ...v }])
    ),
  };

  // Capture nativeOrder once on first render
  if (!result.nativeOrder.length && nativeTabs.length) {
    result.nativeOrder = nativeTabs.map((t) => t.id);
    changed = true;
  }

  // Group allTabs by slugified label
  const groupsByLabel = new Map();
  for (const tab of allTabs.values()) {
    const key = slugify(tab.label);
    if (!groupsByLabel.has(key)) groupsByLabel.set(key, []);
    groupsByLabel.get(key).push(tab);
  }

  const existingOrders = Object.values(result.tabs).map((t) => t.order);
  let nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0;

  for (const [key, group] of groupsByLabel) {
    const native     = group.find((t) => t.native);
    const registered = group.filter((t) => !t.native).sort((a, b) => a.id.localeCompare(b.id));
    const expectedOverrides = [
      ...(native     ? [native.id]           : []),
      ...registered.map((t) => t.id),
    ];

    if (!result.tabs[key]) {
      const rawOrder      = native ? result.nativeOrder.indexOf(native.id) : -1;
      const defaultOrder  = rawOrder >= 0 ? rawOrder : nextOrder++;
      const defaultIndex  = native && registered.length > 0 ? 1 : 0;
      const defaultHidden = registered.some((t) => allTabs.get(t.id)?.hidden === true);
      result.tabs[key] = {
        label:        group[0].label,
        hidden:       defaultHidden,
        order:        defaultOrder,
        currentIndex: defaultIndex,
        overrides:    expectedOverrides,
      };
      changed = true;
    } else {
      const existing = result.tabs[key];
      const current  = [...existing.overrides];
      let dirty = false;

      for (const id of expectedOverrides) {
        if (!current.includes(id)) { current.push(id); dirty = true; }
      }
      const filtered = current.filter((id) => allTabs.has(id));
      if (filtered.length !== current.length) dirty = true;

      if (dirty) {
        const n = filtered.filter((id) => allTabs.get(id)?.native);
        const r = filtered.filter((id) => !allTabs.get(id)?.native).sort();
        result.tabs[key] = {
          ...existing,
          label:        group[0].label,
          overrides:    [...n, ...r],
          currentIndex: Math.min(existing.currentIndex, filtered.length - 1),
        };
        changed = true;
      }
    }
  }

  // Remove groups whose tabs no longer exist
  for (const key of Object.keys(result.tabs)) {
    if (!groupsByLabel.has(key)) {
      delete result.tabs[key];
      changed = true;
    }
  }

  return { settings: result, changed };
}

/**
 * Returns a chainable binding object via Proxy.
 */
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
  on.id    = (id)           => makeBinding(`#${id}`, store);
  on.data  = (attr, value)  =>
    makeBinding(
      value !== undefined ? `[data-${attr}="${value}"]` : `[data-${attr}]`,
      store
    );
  return on;
}

function compileOrder(root, registrations) {
  const nativeTabs = getNativeTabs(root);
  const allTabs = new Map();
  for (const tab of nativeTabs) allTabs.set(tab.id, tab);
  for (const [id, reg] of registrations) {
    if (!allTabs.has(id)) allTabs.set(id, { ...reg, native: false });
  }

  const { settings, changed } = ensureTabSettings(getTabSettings(), nativeTabs, allTabs);
  if (changed) game.settings.set("pf1e-util", SETTINGS_KEY, settings);

  const { tabs } = settings;
  const order      = [];
  const forceHidden = new Set();

  const sortedGroups = Object.entries(tabs).sort(([, a], [, b]) => a.order - b.order);

  for (const [, cfg] of sortedGroups) {
    const activeId = cfg.overrides[cfg.currentIndex] ?? cfg.overrides[0];
    if (!activeId) continue;

    // All inactive overrides in this group are hidden regardless
    for (const id of cfg.overrides) {
      if (id !== activeId) forceHidden.add(id);
    }

    if (cfg.hidden) {
      forceHidden.add(activeId);
      continue;
    }

    const tab = allTabs.get(activeId);
    if (tab) order.push(tab);
  }

  const hidden = Array.from(allTabs.values()).filter((tab) => forceHidden.has(tab.id));

  return { order, hidden, settings };
}

// Track last active tab per app instance so re-renders restore it
const activeTabByApp = new Map();

async function applyOrder(app, html, registrations) {
  const root = resolveElement(html);
  if (!root) return;
  const nav  = root.querySelector(NAV_SELECTOR);
  const body = root.querySelector(BODY_SELECTOR);
  if (!nav || !body) return;

  const { order, hidden, settings } = compileOrder(root, registrations);

  for (const tab of order) {
    if (tab.native) continue;
    const reg = registrations.get(tab.id);
    if (!reg || nav.querySelector(`a[data-tab="${tab.id}"]`)) continue;

    const context    = reg.data ? await reg.data(app.actor) : app.actor;
    const htmlString = await renderTemplate(reg.template, context);
    if (!htmlString) continue;

    const navItem = document.createElement("a");
    navItem.className     = "item";
    navItem.dataset.tab   = tab.id;
    navItem.dataset.group = "primary";
    navItem.textContent   = tab.label;
    nav.append(navItem);

    const pane = document.createElement("div");
    pane.className     = `tab ${tab.id} flexcol`;
    pane.dataset.group = "primary";
    pane.dataset.tab   = tab.id;
    pane.innerHTML     = htmlString;
    body.append(pane);

    for (const { selector, event, fn } of reg.bindings) {
      pane.addEventListener(event, (e) => {
        if (e.target.closest(selector)) fn(e, app.actor);
      });
    }

    if (reg.render) reg.render(app.actor, pane);
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
    item.addEventListener("click", () => activeTabByApp.set(app.appId, item.dataset.tab), { once: false });
  });

  return { order, hidden, settings };
}

export class ActorSheetRegistry {
  #registrations     = new Map();
  #onNextUpdate = null;

  tabs = {
    /**
     * Register a new tab for injection into actor sheets.
     * @param {object} config
     * @param {string} [config.id]       - Tab id. Auto-derived from label slug if omitted.
     * @param {string} config.label      - Display label.
     * @param {string} config.template   - Handlebars template path.
     * @param {Function} [config.data]   - async fn(actor) → template context.
     * @param {Function} [config.render] - fn(actor, pane) called after injection.
     *
     * If a native tab shares the same label, the registered tab shows by default
     * (currentIndex = 1). The user can switch via the tab settings UI.
     */
    new: ({ id, label, template, data, render, hidden = false } = {}) => {
      const bindings = [];
      const reg = { label, template, data, bindings, render, hidden };
      Object.defineProperty(reg, "id", { value: id ?? slugify(label), writable: false, enumerable: true });
      this.#registrations.set(reg.id, reg);
      reg.on = makeOn(bindings);
      return reg;
    },
  };

  initialize() {
    game.settings.register("pf1e-util", SETTINGS_KEY, {
      scope:   "client",
      config:  false,
      type:    Object,
      default: { nativeOrder: [], tabs: {} },
    });

    Hooks.on("renderActorSheet", (app, html) => {
      void applyOrder(app, html, this.#registrations).then((result) => {
        if (result) {
          this.#onNextUpdate?.();
          this.#onNextUpdate = null;
        }
      });
    });

    Hooks.on("closeActorSheet", (app) => {
      activeTabByApp.delete(app.appId);
    });
  }

  /** Returns the current full settings object. */
  getSettings() {
    return getTabSettings();
  }

  /** Saves a full settings object and re-renders open sheets. */
  saveSettings(settings) {
    game.settings.set("pf1e-util", SETTINGS_KEY, settings);
  }

  /** Resets settings to empty (will be rebuilt on next render). */
  resetSettings(callback) {
    if (callback) this.#onNextUpdate = callback;
    game.settings.set("pf1e-util", SETTINGS_KEY, { nativeOrder: [], tabs: {} });
  }
}
