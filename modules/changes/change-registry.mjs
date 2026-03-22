export class ChangeRegistry {
  #providers = [];

  registerTargets(fn) {
    this.#providers.push(fn);
  }

  getTargets(actor) {
    const base = { ...(pf1?.config?.buffTargets ?? {}) };
    for (const fn of this.#providers) {
      const result = fn(actor);
      if (result?.targets) Object.assign(base, result.targets);
    }
    return base;
  }

  getCategories(actor) {
    const base = { ...(pf1?.config?.buffTargetCategories ?? {}) };
    for (const fn of this.#providers) {
      const result = fn(actor);
      if (result?.categories) Object.assign(base, result.categories);
    }
    return base;
  }

  initialize() {
    Hooks.once("ready", () => {
      const CE = pf1?.applications?.ChangeEditor;
      if (!CE?.prototype?._prepareContext) return;
      const registry = this;
      const orig = CE.prototype._prepareContext;
      CE.prototype._prepareContext = async function (...args) {
        const ctx = await orig.call(this, ...args);
        const actor =
          this.document?.parent?.actor ??
          this.object?.parent?.actor ??
          this.item?.actor ??
          null;
        if (actor) {
          ctx.buffTargets = registry.getTargets(actor);
          ctx.buffTargetCategories = registry.getCategories(actor);
        }
        return ctx;
      };
    });
  }
}
