import { initialize as initializePf1eUtility, ready as readyPf1eUtility, ActorSheet, ItemSheet, Chat, Combat, Changes, measureDistance, targetsWithin } from "./pf1e-utility/pf1e-utility.mjs";
import { DataGrid } from "./item-grid/item-grid.mjs";

globalThis.PF1EUtility = {
  Library: {
    measureDistance,
    targetsWithin,
  },
  Sheets: {
    ActorSheet,
    ItemSheet,
  },
  Controls: {
    DataGrid,
  },
  Events: {
    Chat,
    Combat,
  },
  Overrides: {
    Changes,
  },
};

Hooks.once("init", () => {
  console.log("------------------PF1e Util module loaded");
  initializePf1eUtility();
});

Hooks.once("ready", () => {
  console.log("------------------PF1e Util module ready");
  readyPf1eUtility();
});
