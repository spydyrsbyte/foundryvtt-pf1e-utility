import { openScriptCallEditor } from "./script-call-editor.mjs";
import { HelpViewer } from "../help/help-viewer.mjs";

const FLAG_KEY = "scriptCalls";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export const SCRIPT_CALL_TYPES = ["turnStart", "turnEnd", "roundStart", "roundEnd", "combatStart", "combatEnd", "update", "move"];

const TYPE_LABELS = {
  turnStart:   "Turn Start",
  turnEnd:     "Turn End",
  roundStart:  "Round Start",
  roundEnd:    "Round End",
  combatStart: "Combat Start",
  combatEnd:   "Combat End",
  update:      "Update",
  move:        "Move",
};

// ---- Storage helpers -------------------------------------------------------

function getAll(actor) {
  return actor.getFlag("pf1e-utility", FLAG_KEY) ?? [];
}

function getEnabled(actor, type) {
  return getAll(actor).filter((s) => s.enabled && s.type === type);
}

// ---- Execution -------------------------------------------------------------

async function executeScript(entry, context) {
  try {
    const fn = new AsyncFunction(...Object.keys(context), entry.script);
    await fn(...Object.values(context));
  } catch (e) {
    console.error(`PF1EUtility | Script call "${entry.name}" failed:`, e);
  }
}

async function fireForActor(actor, type, context) {
  for (const entry of getEnabled(actor, type)) {
    await executeScript(entry, { actor, ...context });
  }
}

async function fireForCombat(combat, type, extraContext = {}) {
  const seen = new Set();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    await fireForActor(actor, type, { combat, ...extraContext });
  }
}

// ---- Hooks -----------------------------------------------------------------

const updating = new Set();

export function initializeScriptCalls() {
  // update — loop-guarded
  Hooks.on("updateActor", async (actor, updateData) => {
    if (updating.has(actor.id)) return;
    const scripts = getEnabled(actor, "update");
    if (!scripts.length) return;
    updating.add(actor.id);
    try {
      for (const entry of scripts) await executeScript(entry, { actor, updateData });
    } finally {
      updating.delete(actor.id);
    }
  });

  // move — fires at final position only
  Hooks.on("updateToken", (tokenDoc, updateData) => {
    if (!("x" in updateData) && !("y" in updateData)) return;
    const actor = tokenDoc.actor;
    if (!actor) return;
    const position = { x: tokenDoc.x, y: tokenDoc.y };
    void fireForActor(actor, "move", { token: tokenDoc, position });
  });

  // combat events
  let prevActor = null;

  Hooks.on("preUpdateCombat", (combat, updateData) => {
    if ("turn" in updateData || "round" in updateData) {
      prevActor = combat.combatant?.actor ?? null;
    }
  });

  Hooks.on("combatTurn", async (combat) => {
    if (prevActor) await fireForActor(prevActor, "turnEnd", { combat });
    if (combat.combatant?.actor) await fireForActor(combat.combatant.actor, "turnStart", { combat });
    prevActor = null;
  });

  Hooks.on("combatRound", async (combat) => {
    if (prevActor) await fireForActor(prevActor, "turnEnd", { combat });
    await fireForCombat(combat, "roundEnd");
    await fireForCombat(combat, "roundStart");
    prevActor = null;
  });

  Hooks.on("combatStart", async (combat) => {
    await fireForCombat(combat, "combatStart");
  });

  Hooks.on("deleteCombat", async (combat) => {
    await fireForCombat(combat, "combatEnd");
  });
}

// ---- CRUD ------------------------------------------------------------------

export async function addScriptCall(actor, entry) {
  const calls = getAll(actor);
  calls.push({ id: foundry.utils.randomID(), enabled: true, ...entry });
  await actor.setFlag("pf1e-utility", FLAG_KEY, calls);
}

export async function updateScriptCall(actor, id, changes) {
  const calls = getAll(actor).map((s) => (s.id === id ? { ...s, ...changes } : s));
  await actor.setFlag("pf1e-utility", FLAG_KEY, calls);
}

export async function deleteScriptCall(actor, id) {
  const calls = getAll(actor).filter((s) => s.id !== id);
  await actor.setFlag("pf1e-utility", FLAG_KEY, calls);
}

// ---- Sheet tab data --------------------------------------------------------

export function scriptCallsTabData(actor) {
  return { scriptCalls: getAll(actor), types: SCRIPT_CALL_TYPES };
}

// ---- Sheet tab registration ------------------------------------------------

export function registerScriptCallTab(ActorSheet) {
  const tab = ActorSheet.tabs.new({
    id: "pf1e-util-advanced",
    label: "Advanced",
    template: "modules/pf1e-utility/templates/actor-script-calls.hbs",
    data: (actor) => {
      const all = getAll(actor);
      return {
        scriptCalls: SCRIPT_CALL_TYPES.map((type) => ({
          type,
          label: TYPE_LABELS[type],
          items: all.filter((s) => s.type === type),
        })),
        isGM: game.user.isGM,
        owner: actor.isOwner,
      };
    },
    order: { before: "settings" },
  });

  tab.on.data("action", "sc-add").click((e, actor) => {
    const type = e.target.closest("[data-type]")?.dataset.type;
    openScriptCallEditor(actor, null, type);
  });

  tab.on.data("action", "sc-edit").click((e, actor) => {
    const id = e.target.closest("[data-sc-id]").dataset.scId;
    const entry = getAll(actor).find((s) => s.id === id);
    if (entry) openScriptCallEditor(actor, entry);
  });

  tab.on.data("action", "sc-delete").click((e, actor) => {
    const id = e.target.closest("[data-sc-id]").dataset.scId;
    deleteScriptCall(actor, id);
  });

  tab.on(".pf1e-util-help-open").click((e) => {
    const key = e.target.closest("[data-help]").dataset.help;
    new HelpViewer(`modules/pf1e-utility/templates/help/${key}.hbs`).render(true);
  });

  tab.on.data("action", "sc-toggle").click((e, actor) => {
    const id = e.target.closest("[data-sc-id]").dataset.scId;
    const entry = getAll(actor).find((s) => s.id === id);
    if (entry) updateScriptCall(actor, id, { enabled: !entry.enabled });
  });
}
