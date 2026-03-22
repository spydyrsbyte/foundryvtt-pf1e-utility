const NAV_SELECTOR = 'nav.sheet-navigation.tabs[data-group="primary"]';
const BODY_SELECTOR = "section.primary-body";

function resolveElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function makeBinding(selector, store) {
  const binding = new Proxy({}, {
    get(_, event) {
      return (fn) => { store.push({ selector, event, fn }); return binding; };
    },
  });
  return binding;
}

function makeOn(store) {
  const on = (selector) => makeBinding(selector, store);
  on.id = (id) => makeBinding(`#${id}`, store);
  on.data = (attr, value) =>
    makeBinding(value !== undefined ? `[data-${attr}="${value}"]` : `[data-${attr}]`, store);
  return on;
}

function matchesSubtypes(itemType, subtypes) {
  if (subtypes === "*") return true;
  if (Array.isArray(subtypes)) return subtypes.includes(itemType);
  return false;
}

/**
 * Find a native tab nav item and pane by data-tab id or label text.
 * Returns null if not found.
 */
function findNativeTab(nav, body, replaces) {
  if (!replaces) return null;
  // Try data-tab attribute first
  let navItem = nav.querySelector(`a[data-tab="${replaces}"]`);
  // Fall back to label text (case-insensitive)
  if (!navItem) {
    navItem = Array.from(nav.querySelectorAll("a.item[data-tab]"))
      .find((a) => a.textContent.trim().toLowerCase() === replaces.toLowerCase()) ?? null;
  }
  if (!navItem) return null;
  const pane = body.querySelector(`div.tab[data-tab="${navItem.dataset.tab}"]`);
  return { navItem, pane };
}

const activeTabByApp = new Map();

async function applyTab(app, html, reg) {
  const root = resolveElement(html);
  if (!root) return;

  const item = app.document;
  if (!matchesSubtypes(item?.type, reg.subtypes)) return;
  if (reg.enabled && !reg.enabled(item)) return;

  const nav = root.querySelector(NAV_SELECTOR);
  const body = root.querySelector(BODY_SELECTOR);
  if (!nav || !body) return;

  // Skip if already injected
  if (nav.querySelector(`a[data-tab="${reg.id}"]`)) return;

  const context = reg.data ? await reg.data(item) : item;
  const htmlString = await renderTemplate(reg.template, context);
  if (!htmlString) return;

  const navItem = document.createElement("a");
  navItem.className = "item";
  navItem.dataset.tab = reg.id;
  navItem.dataset.group = "primary";
  navItem.textContent = reg.label;

  const pane = document.createElement("div");
  pane.className = `tab ${reg.id} flexcol`;
  pane.dataset.group = "primary";
  pane.dataset.tab = reg.id;
  pane.innerHTML = htmlString;

  for (const { selector, event, fn } of reg.bindings) {
    pane.addEventListener(event, (e) => {
      if (e.target.closest(selector)) fn(e, item);
    });
  }

  // Position: replaces > order.before > order.after > append
  const native = reg.replaces ? findNativeTab(nav, body, reg.replaces) : null;
  if (native) {
    nav.insertBefore(navItem, native.navItem);
    native.pane ? body.insertBefore(pane, native.pane) : body.append(pane);
    native.navItem.remove();
    native.pane?.remove();
  } else if (reg.order?.before) {
    const ref = nav.querySelector(`a[data-tab="${reg.order.before}"]`);
    ref ? nav.insertBefore(navItem, ref) : nav.append(navItem);
    const refPane = body.querySelector(`div.tab[data-tab="${reg.order.before}"]`);
    refPane ? body.insertBefore(pane, refPane) : body.append(pane);
  } else if (reg.order?.after) {
    const ref = nav.querySelector(`a[data-tab="${reg.order.after}"]`);
    ref?.nextSibling ? nav.insertBefore(navItem, ref.nextSibling) : nav.append(navItem);
    const refPane = body.querySelector(`div.tab[data-tab="${reg.order.after}"]`);
    refPane?.nextSibling ? body.insertBefore(pane, refPane.nextSibling) : body.append(pane);
  } else {
    nav.append(navItem);
    body.append(pane);
  }

  // Restore previously active tab on re-render
  const lastTab = activeTabByApp.get(app.appId);
  if (lastTab && nav.querySelector(`a[data-tab="${lastTab}"]`)) {
    app._tabs?.[0]?.activate(lastTab);
  }

  nav.querySelectorAll("a.item[data-tab]").forEach((el) => {
    el.addEventListener("click", () => activeTabByApp.set(app.appId, el.dataset.tab));
  });
}

export class ItemSheetRegistry {
  #registrations = [];

  tabs = {
    /**
     * Register a new tab for injection into item sheets.
     * @param {object} config
     * @param {string} [config.id]          - Tab id. Auto-derived from label slug if omitted.
     * @param {string} config.label         - Display label shown in the tab nav.
     * @param {string} config.template      - Path to the Handlebars template.
     * @param {Function} [config.data]      - Optional async fn(item) returning template context.
     * @param {string|string[]} [config.subtypes="*"] - Item type(s) to inject into. "*" = all.
     * @param {string} [config.replaces]    - Native tab id or label to replace.
     * @param {{before:string}|{after:string}} [config.order] - Position if not replacing.
     * @param {Function} [config.enabled]   - Optional fn(item) → bool. Skip injection if false.
     * @returns {{ on: Function }} Tab instance for attaching event listeners.
     */
    new: ({ id, label, template, data, subtypes = "*", replaces, order, enabled } = {}) => {
      const bindings = [];
      const reg = { label, template, data, subtypes, replaces, order, enabled, bindings };
      Object.defineProperty(reg, "id", { value: id ?? slugify(label), writable: false, enumerable: true });
      this.#registrations.push(reg);
      reg.on = makeOn(bindings);
      return reg;
    },
  };

  initialize() {
    Hooks.on("renderItemSheetPF", (app, html) => {
      for (const reg of this.#registrations) {
        void applyTab(app, html, reg);
      }
    });

    Hooks.on("closeItemSheetPF", (app) => {
      activeTabByApp.delete(app.appId);
    });
  }
}
