const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HelpViewer extends HandlebarsApplicationMixin(ApplicationV2) {
  #templatePath;

  constructor(templatePath) {
    super();
    this.#templatePath = templatePath;
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-v2", "help-browser"],
    window: { title: "Help", icon: "fa-solid fa-book", resizable: true },
    position: { width: 560, height: 600 },
  };

  static PARTS = {
    content: { template: "modules/pf1e-utility/templates/help/help-viewer.hbs" },
  };

  async _prepareContext() {
    const html = await renderTemplate(this.#templatePath, {});
    return { content: html };
  }
}
