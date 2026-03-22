const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TabOrderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf1e-util-tab-order",
    window: { title: "Actor Sheet Tab Settings" },
    position: { width: 600, height: "auto" },
    actions: {
      save:  TabOrderApp.#onSave,
      reset: TabOrderApp.#onReset,
    },
  };

  static PARTS = {
    form: { template: "modules/pf1e-utility/templates/tab-order.hbs" },
  };

  async _prepareContext() {
    const settings = PF1EUtility.Sheets.ActorSheet.getSettings();
    const { nativeOrder, tabs } = settings;

    if (!Object.keys(tabs).length) return { hasTabs: false };

    const nativeIds   = new Set(nativeOrder);
    const systemLabel = game.system.id.toUpperCase();

    const tabList = Object.entries(tabs)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([labelKey, cfg]) => ({
        labelKey,
        label:     cfg.label,
        hidden:    cfg.hidden,
        showRadio: cfg.overrides.length > 1,
        overrides: cfg.overrides.map((id, i) => ({
          id,
          displayLabel: nativeIds.has(id) ? `Native ${systemLabel}` : id,
          index:   i,
          checked: i === cfg.currentIndex,
        })),
      }));

    return { hasTabs: true, tabs: tabList };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#activateTabs();
    this.#activateDragSort();
  }

  #activateTabs() {
    const nav = this.element.querySelector(".tab-settings-nav");
    if (!nav) return;
    nav.addEventListener("click", (e) => {
      const tab = e.target.closest(".tab-settings-tab");
      if (!tab) return;
      const key = tab.dataset.labelKey;

      nav.querySelectorAll(".tab-settings-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      this.element.querySelectorAll(".tab-settings-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.labelKey === key);
      });
    });
  }

  #activateDragSort() {
    const nav = this.element.querySelector(".tab-settings-nav");
    if (!nav) return;
    let dragged = null;

    nav.addEventListener("dragstart", (e) => {
      dragged = e.target.closest(".tab-settings-tab");
      dragged?.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    nav.addEventListener("dragend", () => {
      dragged?.classList.remove("dragging");
      dragged = null;
    });

    nav.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragged) return;
      const target = e.target.closest(".tab-settings-tab");
      if (target && target !== dragged) {
        const rect  = target.getBoundingClientRect();
        const after = e.clientX > rect.left + rect.width / 2;
        after ? target.after(dragged) : target.before(dragged);
      }
    });
  }

  static #onSave() {
    const settings = PF1EUtility.Sheets.ActorSheet.getSettings();
    const newTabs  = Object.fromEntries(
      Object.entries(settings.tabs).map(([k, v]) => [k, { ...v }])
    );

    this.element.querySelectorAll(".tab-settings-tab").forEach((tab, i) => {
      const labelKey = tab.dataset.labelKey;
      if (!newTabs[labelKey]) return;

      const panel        = this.element.querySelector(`.tab-settings-panel[data-label-key="${labelKey}"]`);
      const hidden       = panel?.querySelector(".tab-hidden-check")?.checked ?? newTabs[labelKey].hidden;
      const checkedRadio = panel?.querySelector("input[type='radio']:checked");
      const currentIndex = checkedRadio ? parseInt(checkedRadio.value) : newTabs[labelKey].currentIndex;

      newTabs[labelKey] = { ...newTabs[labelKey], hidden, order: i, currentIndex };
    });

    PF1EUtility.Sheets.ActorSheet.saveSettings({ ...settings, tabs: newTabs });
    Object.values(ui.windows).filter((w) => w.actor).forEach((s) => s.render());
    this.close();
  }

  static #onReset() {
    PF1EUtility.Sheets.ActorSheet.resetSettings(() => this.render());
    Object.values(ui.windows).filter((w) => w.actor).forEach((s) => s.render());
  }
}
