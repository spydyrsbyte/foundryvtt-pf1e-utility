import { addScriptCall, updateScriptCall } from "./script-calls.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ScriptCallEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  #actor;
  #entry;
  #defaultType;

  constructor(actor, entry = null, defaultType = "turnStart") {
    super();
    this.#actor = actor;
    this.#entry = entry;
    this.#defaultType = defaultType;
    // Exposed for static action handler
    this._actor = actor;
    this._entry = entry;
    this._defaultType = defaultType;
  }

  static DEFAULT_OPTIONS = {
    classes: ["pf1-v2", "script-editor"],
    window: { title: "Script Call", resizable: true },
    position: { width: 620, height: 500 },
    actions: {
      save: ScriptCallEditor.#onSave,
    },
  };

  static PARTS = {
    form: { template: "modules/pf1e-utility/templates/script-call-editor.hbs" },
  };

  async _prepareContext() {
    return {
      entry: this.#entry ?? { name: "", type: this.#defaultType, script: "", enabled: true },
    };
  }

  static async #onSave() {
    const form = this.element.querySelector("form");
    const data = {
      name: form.querySelector("[name='name']").value.trim(),
      type: this._entry?.type ?? this._defaultType,
      script: form.querySelector("[name='command']").value,
      enabled: this._entry?.enabled ?? true,
    };

    if (this._entry) await updateScriptCall(this._actor, this._entry.id, data);
    else await addScriptCall(this._actor, data);
    this.close();
  }
}

export function openScriptCallEditor(actor, entry = null, defaultType = "turnStart") {
  new ScriptCallEditor(actor, entry, defaultType).render(true);
}
