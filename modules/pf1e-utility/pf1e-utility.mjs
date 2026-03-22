import { ActorSheetRegistry } from "../sheet/actor-sheet.mjs";
import { ItemSheetRegistry } from "../sheet/item-sheet.mjs";
import { TabOrderApp } from "../sheet/tab-order-app.mjs";
import { ChatRegistry } from "../chat/chat.mjs";
import { initializeRollVisibility } from "../chat/roll-visibility.mjs";
import { CombatRegistry } from "../combat/combat.mjs";
import { initializeScriptCalls, registerScriptCallTab } from "../actor/script-calls.mjs";
import { registerDebugTab } from "../actor/debug-tab.mjs";
import { measureDistance, targetsWithin } from "../utils/distance.mjs";
import { ChangeRegistry } from "../changes/change-registry.mjs";
import { initializeBuffChangesTab } from "../changes/buff-changes-tab.mjs";
import { initializeFeatures2Tab } from "../actor/features2-tab.mjs";

export const ActorSheet = new ActorSheetRegistry();
export const ItemSheet = new ItemSheetRegistry();
export const Chat = new ChatRegistry();
export const Combat = new CombatRegistry();
export const Changes = new ChangeRegistry();

export function initialize() {
  ActorSheet.initialize();
  ItemSheet.initialize();
  Chat.initialize();
  Combat.initialize();
  Changes.initialize();
  initializeRollVisibility();
  initializeScriptCalls();
  registerScriptCallTab(ActorSheet);
  registerDebugTab(ActorSheet);
  initializeBuffChangesTab(ItemSheet, Changes);
  initializeFeatures2Tab(ActorSheet);

  game.settings.registerMenu("pf1e-utility", "actorSheetTabOrder", {
    name: "Actor Sheet Tab Order",
    label: "Configure Tab Order",
    hint: "Drag to reorder tabs on the actor sheet.",
    icon: "fa-solid fa-bars",
    type: TabOrderApp,
    restricted: false,
  });
}

export { measureDistance, targetsWithin };

export function ready() {}
