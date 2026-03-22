function resolveElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element instanceof HTMLElement) return html.element;
  return null;
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

/**
 * tab.on(selector)         — arbitrary CSS selector
 * tab.on.data("key")       — [data-key]
 * tab.on.data("key","val") — [data-key="val"]
 */
function makeOn(store) {
  const on = (selector) => makeBinding(selector, store);
  on.data = (attr, value) =>
    makeBinding(
      value !== undefined ? `[data-${attr}="${value}"]` : `[data-${attr}]`,
      store
    );
  return on;
}

export class ChatRegistry {
  #bindings = [];

  on = makeOn(this.#bindings);

  initialize() {
    Hooks.on("renderChatMessage", (message, html) => {
      const root = resolveElement(html);
      if (!root) return;
      for (const { selector, event, fn } of this.#bindings) {
        root.addEventListener(event, (e) => {
          if (e.target.closest(selector)) fn(e, message);
        });
      }
    });
  }
}
