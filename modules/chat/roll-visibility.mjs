const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SETTING_KEY = "rollVisibility";

const LEVELS = ["nothing", "hideBonus", "hideRoll"];

function getSettings() {
  return game.settings.get("pf1e-utility", SETTING_KEY);
}

// ---- Permission level of current user for a given actor ----------------------

function getPermissionLevel(actorId) {
  if (!actorId) return "none";
  const actor = game.actors.get(actorId);
  if (!actor) return "none";
  if (actor.testUserPermission(game.user, "OWNER")) return "owner";
  if (actor.testUserPermission(game.user, "OBSERVER")) return "observer";
  return "none";
}

// ---- Detect roll type from rendered HTML -------------------------------------

function detectRollType(html) {
  if (html.querySelector(".chat-attack")) return "attack";
  if (html.querySelector(".dice-roll") && !html.querySelector(".item-card")) return "skill";
  return null;
}

// ---- DOM mutations (CSS class only — no innerHTML changes) -------------------

function suppressInlineTooltips(root) {
  root.querySelectorAll(".inline-roll").forEach((el) => {
    el.addEventListener("pointerenter", () => game.tooltip?.deactivate(), true);
  });
}

function applyHideBonus(html) {
  html.classList.add("pf1e-util-hide-bonus");
  suppressInlineTooltips(html);
}

function applyHideRoll(html) {
  html.classList.add("pf1e-util-hide-roll");
  suppressInlineTooltips(html);
}

// ---- Main hook ---------------------------------------------------------------

export function initializeRollVisibility() {
  game.settings.register("pf1e-utility", SETTING_KEY, {
    scope: "world",
    config: false,
    type: Object,
    default: {
      attack: { none: "nothing", observer: "nothing" },
      skill:  { none: "nothing", observer: "nothing" },
    },
  });

  game.settings.registerMenu("pf1e-utility", SETTING_KEY, {
    name: "Roll Visibility",
    label: "Configure Roll Visibility",
    hint: "Control how much roll information non-owners can see.",
    icon: "fa-solid fa-eye-slash",
    type: RollVisibilitySettings,
    restricted: true,
  });

  Hooks.on("renderChatMessage", (message, html) => {
    if (game.user.isGM) return;

    const root = html instanceof HTMLElement ? html : html[0] ?? html.element;
    if (!root) return;

    const rollType = detectRollType(root);
    if (!rollType) return;

    const actorId = root.querySelector("[data-actor-id]")?.dataset.actorId
      ?? message.speaker?.actor;
    const perm = getPermissionLevel(actorId);

    // Owner always sees everything
    if (perm === "owner") return;

    const settings = getSettings();
    const level = settings[rollType]?.[perm] ?? "nothing";

    if (level === "hideBonus") applyHideBonus(root);
    else if (level === "hideRoll") applyHideRoll(root);
  });
}

// ---- Settings UI -------------------------------------------------------------

class RollVisibilitySettings extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pf1e-util-roll-visibility",
    window: { title: "Roll Visibility", resizable: false },
    position: { width: 420, height: "auto" },
    actions: { save: RollVisibilitySettings.#onSave },
  };

  static PARTS = {
    form: { template: "modules/pf1e-utility/templates/roll-visibility-settings.hbs" },
  };

  async _prepareContext() {
    const s = getSettings();
    return {
      groups: [
        { key: "attack", label: "Attack Rolls", ...s.attack },
        { key: "skill",  label: "Skill Rolls",  ...s.skill  },
      ],
    };
  }

  static #onSave() {
    const form = this.element.querySelector("form");
    const val = (name) => form.querySelector(`[name="${name}"]`).value;
    game.settings.set("pf1e-utility", SETTING_KEY, {
      attack: { none: val("attack.none"), observer: val("attack.observer") },
      skill:  { none: val("skill.none"),  observer: val("skill.observer") },
    });
    this.close();
  }
}
