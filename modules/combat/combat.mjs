export class CombatRegistry {
  #callbacks = {
    combatStart: [],
    combatEnd: [],
    turnStart: [],
    turnEnd: [],
    roundStart: [],
    roundEnd: [],
  };

  on = {
    /** Fires when combat begins. fn(combat) */
    combatStart: (fn) => { this.#callbacks.combatStart.push(fn); return this.on; },
    /** Fires when combat ends. fn(combat) */
    combatEnd: (fn) => { this.#callbacks.combatEnd.push(fn); return this.on; },
    /** Fires when it becomes an actor's turn. fn(actor, combat) */
    turnStart: (fn) => { this.#callbacks.turnStart.push(fn); return this.on; },
    /** Fires when an actor's turn ends. fn(actor, combat) */
    turnEnd: (fn) => { this.#callbacks.turnEnd.push(fn); return this.on; },
    /** Fires when a new round begins. fn(combat) */
    roundStart: (fn) => { this.#callbacks.roundStart.push(fn); return this.on; },
    /** Fires when a round ends. fn(combat) */
    roundEnd: (fn) => { this.#callbacks.roundEnd.push(fn); return this.on; },
  };

  #fire(event, ...args) {
    for (const fn of this.#callbacks[event]) fn(...args);
  }

  initialize() {
    let prevActor = null;

    Hooks.on("preUpdateCombat", (combat, updateData) => {
      if ("turn" in updateData || "round" in updateData) {
        prevActor = combat.combatant?.actor ?? null;
      }
    });

    Hooks.on("combatTurn", (combat) => {
      if (prevActor) this.#fire("turnEnd", prevActor, combat);
      if (combat.combatant?.actor) this.#fire("turnStart", combat.combatant.actor, combat);
      prevActor = null;
    });

    Hooks.on("combatStart", (combat) => {
      this.#fire("combatStart", combat);
    });

    Hooks.on("deleteCombat", (combat) => {
      this.#fire("combatEnd", combat);
    });

    Hooks.on("combatRound", (combat) => {
      if (prevActor) this.#fire("turnEnd", prevActor, combat);
      this.#fire("roundEnd", combat);
      this.#fire("roundStart", combat);
      prevActor = null;
    });
  }
}
