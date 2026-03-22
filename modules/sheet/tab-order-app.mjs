const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TabOrderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf1e-util-tab-order",
    window: { title: "Actor Sheet Tab Order" },
    position: { width: "auto", height: "auto" },
    actions: {
      save: TabOrderApp.#onSave,
      reset: TabOrderApp.#onReset,
    },
  };

  static PARTS = {
    form: { template: "modules/pf1e-utility/templates/tab-order.hbs" },
  };

  async _prepareContext() {
    const { order, hidden } = PF1EUtility.Sheets.ActorSheet.getOrder();
    return { tabs: order, hidden };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#activateDragSort();
  }

  #activateDragSort() {
    const form = this.element;
    let dragged = null;

    form.addEventListener("dragstart", (e) => {
      dragged = e.target.closest(".tab-order-item");
      dragged?.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    form.addEventListener("dragend", () => {
      dragged?.classList.remove("dragging");
      dragged = null;
    });

    form.querySelectorAll(".tab-order-nav").forEach((nav) => {
      nav.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragged) return;

        const target = e.target.closest(".tab-order-item");
        if (target && target !== dragged) {
          const rect = target.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          after ? target.after(dragged) : target.before(dragged);
        } else if (!target) {
          nav.append(dragged);
        }
      });
    });
  }

  static #onSave() {
    const visible = Array.from(
      this.element.querySelectorAll('[data-zone="visible"] .tab-order-item')
    ).map((el) => el.dataset.tabId);

    const hidden = Array.from(
      this.element.querySelectorAll('[data-zone="hidden"] .tab-order-item')
    ).map((el) => el.dataset.tabId);

    PF1EUtility.Sheets.ActorSheet.saveOrder(visible, hidden);
    Object.values(ui.windows).filter((w) => w.actor).forEach((s) => s.render());
    this.close();
  }

  static #onReset() {
    const dialog = this;
    PF1EUtility.Sheets.ActorSheet.clearOrder(() => dialog.render());
    Object.values(ui.windows).filter((w) => w.actor).forEach((s) => s.render());
  }
}
