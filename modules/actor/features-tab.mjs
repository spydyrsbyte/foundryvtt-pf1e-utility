const MODULE = "pf1e-utility";
const LEVEL_FORMULA_KEY = "levelFeatFormula";
const TRAIT_COUNT_KEY = "traitCount";
const ITEM_COLUMN_DEFINITION ={
  id:{path:'item._id',type:'String'}
  ,image:{path:'item.img',type:'String'}
  ,name:{path:'item.name',type:'String'}
  ,type:{path:'item.system.subType',type:'String'}
  ,charges:{type:'Compound',
    value:{
        value:{path:'item.system.uses.value',type:'Number'}
        ,max:{path:'item.system.uses.maxFormula',type:'RollFormula'}
    }
  }
  ,use:{type:'MultiBoolean'
    ,or:[
      {path:'item.system.actions.length',type:'BooleanCheckNumber',value:'>0'},
      ,{path:'item.system.scriptCalls',type:'ArrayCheck',value:(val)=>{return val?.category === "use"}}
    ]
    ,and:[]
  }
}



function isStaticFormula(formula) {
  const t = String(formula ?? "").trim();
  return t !== "" && !isNaN(Number(t));
}

function findTicks(formula, maxLevel, makeData) {
  const ticks = [];
  let prev = 0;
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const substituted = Roll.replaceFormulaData(formula, makeData(lvl), { missing: "0" });
    let result = 0;
    try { result = Math.max(0, Math.floor(Roll.safeEval(substituted) ?? 0)); } catch { result = 0; }
    while (result > prev) { ticks.push(lvl); prev++; }
  }
  return ticks;
}



function itemColumns(item) {
  if (!item) return { abilityType: "", hasCharges: false, chargesVal: null, chargesMax: null, hasAction: false, actionType: "" };
  const aType = item.system.abilityType ?? "";
  const aTypeLabel = pf1.config.abilityTypes[aType]?.short ?? aType;

  const uses = item.system.uses ?? null;
  const chargesMax = uses?.max ?? null;
  const hasCharges = chargesMax !== null && chargesMax !== 0;
  return {
    abilityType: aTypeLabel,
    hasCharges, chargesVal: uses?.value ?? null, chargesMax,
    hasAction: (item.system.actions?.length ?? 0) > 0,
    actionType: item.system.actions?.[0]?.activation?.type ?? "",
  };
}

function resolveSlots(ticks, isStatic, count, stored, actor) {
  if (isStatic) {
    return Array.from({ length: count }, (_, i) => {
      const s = stored[i];
      const item = s?.itemId ? actor.items.get(s.itemId) : null;
      return { level: null, itemId: item?.id ?? null, itemName: item?.name ?? null, itemImg: item?.img ?? null, filled: !!item, ...itemColumns(item) };
    });
  }
  const byLevel = new Map(stored.map(s => [s.level, s]));
  return ticks.map(lvl => {
    const s = byLevel.get(lvl);
    const item = s?.itemId ? actor.items.get(s.itemId) : null;
    return { level: lvl, itemId: item?.id ?? null, itemName: item?.name ?? null, itemImg: item?.img ?? null, filled: !!item, ...itemColumns(item) };
  });
}

function sortFeatures(features) {
  features.sort((a, b) => {
    const la = parseInt(a.featureLevel) || 0;
    const lb = parseInt(b.featureLevel) || 0;
    if (la !== lb) return la - lb;
    return a.sort - b.sort;
  });
}

function buildClassGroups(actor) {
  const actorClassNames = new Set(actor.items.filter(i => i.type === "class").map(i => i.name));
  const classMap = new Map();

  for (const classItem of actor.items.filter(i => i.type === "class")) {
    classMap.set(classItem.name, { name: classItem.name, tag: classItem.system.tag ?? "", level: classItem.system.level ?? null, sort: classItem.sort, features: [], isOther: false });
  }

  for (const item of actor.items) {
    if (item.type !== "feat" || item.system.subType !== "classFeat") continue;
    const className = item.system.associations?.classes?.[0];
    const groupKey = (className && actorClassNames.has(className)) ? className : "Other";
    if (!classMap.has(groupKey)) {
      const classItem = groupKey !== "Other" ? actor.items.find(i => i.type === "class" && i.name === groupKey) : null;
      classMap.set(groupKey, { name: groupKey, tag: classItem?.system.tag ?? "", level: classItem?.system.level ?? null, sort: classItem?.sort ?? Infinity, features: [], isOther: groupKey === "Other" });
    }
    classMap.get(groupKey).features.push({
      id: item.id, name: item.name, img: item.img, disabled: item.system.disabled ?? false,
      featureLevel: item.getFlag(MODULE, "classFeatureLevel") ?? "",
      parentFeatureId: item.getFlag(MODULE, "parentFeatureId") ?? null,
      sort: item.sort,
      children: [],
      ...itemColumns(item),
    });
  }

  const classes = [...classMap.values()].sort((a, b) => {
    if (a.isOther !== b.isOther) return a.isOther ? 1 : -1;
    return a.sort - b.sort;
  });

  for (const cls of classes) {
    const byId = new Map(cls.features.map(f => [f.id, f]));
    const roots = [];
    for (const f of cls.features) {
      if (f.parentFeatureId && byId.has(f.parentFeatureId)) {
        byId.get(f.parentFeatureId).children.push(f);
      } else {
        roots.push(f);
      }
    }
    sortFeatures(roots);
    for (const f of byId.values()) sortFeatures(f.children);
    cls.features = roots;
  }

  return classes;
}

function buildLevelSlots(actor) {
  const formula = game.settings.get(MODULE, LEVEL_FORMULA_KEY);
  const charLevel = actor.system.details?.level?.value ?? 0;
  const stored = actor.getFlag(MODULE, "levelFeatSlots") ?? [];
  if (isStaticFormula(formula)) {
    return resolveSlots([], true, parseInt(formula) || 0, stored, actor);
  }
  const ticks = findTicks(formula, charLevel, lvl => ({ details: { level: { value: lvl } } }));
  return resolveSlots(ticks, false, 0, stored, actor);
}

function buildBonusFeatGroups(actor) {
  const groups = [];
  for (const item of actor.items) {
    const bonusChange = (item.system.changes ?? []).find(ch => ch.target === "bonusFeats");
    if (!bonusChange) continue;
    const className = item.system.associations?.classes?.[0] ?? null;
    const classItem = className ? actor.items.find(i => i.type === "class" && i.name === className) : null;
    const classLevel = classItem?.system.level ?? 0;
    const formula = bonusChange.formula ?? "";
    const stored = item.getFlag(MODULE, "bonusFeatSlots") ?? [];
    const isStatic = !formula || isStaticFormula(formula);
    const slots = isStatic
      ? resolveSlots([], true, parseInt(formula) || 0, stored, actor)
      : resolveSlots(findTicks(formula, classLevel, lvl => ({ level: lvl, class: { level: lvl } })), false, 0, stored, actor);
    const label = className ? `${className} : ${item.name}` : item.name;
    groups.push({ granterId: item.id, label, slots });
  }
  return groups;
}

function buildOtherFeats(actor, levelSlots, bonusFeatGroups) {
  const slotted = new Set();
  for (const s of levelSlots) if (s.itemId) slotted.add(s.itemId);
  for (const g of bonusFeatGroups) for (const s of g.slots) if (s.itemId) slotted.add(s.itemId);
  return actor.items
    .filter(i => i.type === "feat" && i.system.subType === "feat" && !slotted.has(i.id))
    .map(i => ({ id: i.id, name: i.name, img: i.img, sort: i.sort, ...itemColumns(i) }))
    .sort((a, b) => a.sort - b.sort);
}

function buildRacialTraits(actor) {
  return actor.items
    .filter(i => i.type === "feat" && i.system.subType === "racial")
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));
}

function buildTemplates(actor) {
  return actor.items
    .filter(i => i.type === "feat" && i.system.subType === "template")
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));
}

function buildMiscFeatures(actor) {
  return actor.items
    .filter(i => i.type === "feat" && i.system.subType === "misc")
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));
}

function buildTraitSlots(actor) {
  const count = game.settings.get(MODULE, TRAIT_COUNT_KEY);
  const stored = actor.getFlag(MODULE, "traitSlots") ?? [];
  return resolveSlots([], true, count, stored, actor);
}

function buildOtherTraits(actor, traitSlots) {
  const slotted = new Set(traitSlots.filter(s => s.itemId).map(s => s.itemId));
  return actor.items
    .filter(i => i.type === "feat" && i.system.subType === "trait" && !slotted.has(i.id))
    .map(i => ({ id: i.id, name: i.name, img: i.img, sort: i.sort, ...itemColumns(i) }))
    .sort((a, b) => a.sort - b.sort);
}

function l(key) {
  return game.i18n.localize(key);
}

function buildFeaturesContext(actor) {
  const levelSlots = buildLevelSlots(actor);
  const bonusFeatGroups = buildBonusFeatGroups(actor);
  const traitSlots = buildTraitSlots(actor);
  const classes = buildClassGroups(actor);
  const otherFeats = buildOtherFeats(actor, levelSlots, bonusFeatGroups);
  const otherTraits = buildOtherTraits(actor, traitSlots);
  const racialTraits = buildRacialTraits(actor);
  const templates = buildTemplates(actor);
  const miscFeatures = buildMiscFeatures(actor);

  const classesCount = classes.reduce((sum, c) => sum + c.features.length, 0);
  const featsCount = levelSlots.filter(s => s.filled).length
    + bonusFeatGroups.reduce((sum, g) => sum + g.slots.filter(s => s.filled).length, 0)
    + otherFeats.length;
  const traitsCount = traitSlots.filter(s => s.filled).length + otherTraits.length;

  const labels = {
    sectionClasses:       l("PF1EUtility.Features.SectionClasses"),
    sectionFeats:         l("PF1EUtility.Features.SectionFeats"),
    sectionTraits:        l("PF1EUtility.Features.SectionTraits"),
    sectionRacialTraits:  l("PF1EUtility.Features.SectionRacialTraits"),
    sectionTemplates:     l("PF1EUtility.Features.SectionTemplates"),
    sectionMiscellaneous: l("PF1EUtility.Features.SectionMiscellaneous"),
  };

  return {
    labels,
    classes, classesCount,
    levelSlots,
    bonusFeatGroups,
    otherFeats, featsCount,
    traitSlots,
    otherTraits, traitsCount,
    racialTraits,
    templates,
    miscFeatures,
  };
}

async function addToSlots(flagTarget, flagKey, level, newItemId) {
  const slots = [...(flagTarget.getFlag(MODULE, flagKey) ?? [])];
  if (level !== null) {
    const idx = slots.findIndex(s => s.level === level);
    if (idx >= 0) slots[idx] = { level, itemId: newItemId };
    else slots.push({ level, itemId: newItemId });
  } else {
    slots.push({ itemId: newItemId });
  }
  await flagTarget.setFlag(MODULE, flagKey, slots);
}

async function openFeatBrowser(anchor, subType = null) {
  const sheet = anchor.closest(".app.sheet") ?? anchor.closest(".window-app");
  const sheetZ = sheet ? (parseInt(getComputedStyle(sheet).zIndex) || 0) : 0;
  const browseCfg = subType ? pf1.config.sheetSections?.features?.[subType]?.browse : null;
  const category = browseCfg?.category ?? "feats";
  const browser = pf1.applications.compendiums[category];
  if (!browser) return;
  if (browseCfg) {
    const filters = {};
    for (const [k, v] of Object.entries(browseCfg)) {
      if (k === "category" || k === "level") continue;
      filters[k] = Array.isArray(v) ? v : [v];
    }
    if (Object.keys(filters).length) browser._queueFilters(filters);
  }
  await browser._render(true, { focus: true });
  const el = browser.element?.[0] ?? browser.element;
  if (el) el.style.zIndex = sheetZ + 2;
}

function parseSlotLevel(val) {
  return (!val || val === "") ? null : parseInt(val);
}

// Resolve a dropped item — if from compendium, create on actor first; if already on actor, use as-is
async function resolveDroppedItem(data, actor) {
  if (!data?.uuid) return null;
  const source = await fromUuid(data.uuid);
  if (!source) return null;
  if (source.parent === actor) return source;
  // From compendium or elsewhere — create on actor
  const [created] = await actor.createEmbeddedDocuments("Item", [source.toObject()]);
  return created ?? null;
}

function showSlotPopup(anchor, actor, label, level, onDrop, subType = "feat") {
  document.querySelector(".pf1e-util-slot-popup")?.remove();

  const popup = document.createElement("div");
  popup.className = "pf1e-util-slot-popup";
  const levelStr = level !== null ? ` &nbsp;( ${level} )` : "";
  popup.innerHTML = `<div class="pf1e-util-slot-popup-zone">
    <div class="pf1e-util-slot-popup-label">${label}${levelStr}</div>
    <div class="pf1e-util-slot-popup-hint">Drop feat here</div>
  </div>`;

  document.body.append(popup);

  // Cover the top half of the actor sheet, just above its z-index
  const sheet = anchor.closest(".app.sheet") ?? anchor.closest(".window-app");
  if (sheet) {
    const r = sheet.getBoundingClientRect();
    const sheetZ = parseInt(window.getComputedStyle(sheet).zIndex) || 0;
    popup.style.zIndex = sheetZ + 1;
    popup.style.left   = `${r.left}px`;
    popup.style.top    = `${r.top + window.scrollY}px`;
    popup.style.width  = `${r.width}px`;
    popup.style.height = `${r.height / 2}px`;
  } else {
    popup.style.left   = "10vw";
    popup.style.top    = "10vh";
    popup.style.width  = "80vw";
    popup.style.height = "40vh";
  }

  const zone = popup.querySelector(".pf1e-util-slot-popup-zone");

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragover");
  });

  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const item = await resolveDroppedItem(data, actor);
    if (!item) return;
    // Only slot it if it's actually a feat subtype; other subtypes land in their natural section
    if (item.system?.subType === subType) await onDrop(item);
    close();
  });

  function close() {
    popup.remove();
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("pointerdown", onPointerdown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  function onPointerdown(e) {
    if (popup.contains(e.target)) return;
    if (sheet && sheet.contains(e.target)) { close(); return; } // clicking the actor sheet closes it
    if (e.target.closest(".app")) return; // clicking any other Foundry window keeps it alive
    close();
  }

  document.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerdown);
}

export function initializeFeaturesTab(ActorSheet) {
  game.settings.register(MODULE, LEVEL_FORMULA_KEY, {
    name: "Level Feat Formula",
    hint: "Formula for feats gained by character level. Use @details.level.value for character level.",
    scope: "client",
    config: true,
    type: String,
    default: "ceil(@details.level.value / 2)",
  });

  game.settings.register(MODULE, TRAIT_COUNT_KEY, {
    name: "Trait Count",
    hint: "Number of trait slots available to characters.",
    scope: "client",
    config: true,
    type: Number,
    default: 2,
  });

  const reg = ActorSheet.tabs.new({
    id: "pf1e-util-features",
    label: "Features",
    template: "modules/pf1e-utility/templates/actor-features-tab.hbs",
    data: buildFeaturesContext,
    order: { after: "feats" },
  });

  // Collapse / expand any header with data-collapse-target
  reg.on("[data-collapse-target]").click((e) => {
    if (e.target.closest("[data-action]")) return;
    const header = e.target.closest("[data-collapse-target]");
    if (!header) return;
    const bodyId = header.dataset.collapseTarget;
    const body = header.parentElement?.querySelector(`[data-body-id="${bodyId}"]`);
    if (!body) return;
    const collapsed = body.classList.toggle("collapsed");
    header.classList.toggle("collapsed", collapsed);
  });

  // Click-to-edit class feature level
  reg.on.data("action", "edit-feature-level").click((e, actor) => {
    const span = e.target.closest("[data-action='edit-feature-level']");
    if (!span) return;
    const itemId = span.dataset.itemId;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = span.dataset.level ?? "";
    input.className = "pf1e-util-ft-feature-level-input";
    span.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("blur", async () => {
      const val = input.value.trim();
      const item = actor.items.get(itemId);
      if (item) await item.setFlag(MODULE, "classFeatureLevel", val === "" ? null : parseInt(val));
      const span2 = document.createElement("span");
      span2.className = "pf1e-util-ft-feature-level pf1e-util-editable-label";
      span2.dataset.action = "edit-feature-level";
      span2.dataset.itemId = itemId;
      span2.dataset.level = val;
      span2.title = "Click to set level gained";
      span2.innerHTML = val ? val : "&mdash;";
      input.replaceWith(span2);
    }, { once: true });
  });

  // Create class feature from section header
  reg.on.data("action", "create-class-feature").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Class Feature", system: { subType: "classFeat" } }]);
    item?.sheet.render(true);
  });

  // Browse class features from section header
  reg.on.data("action", "browse-class-feature").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-class-feature']");
    openFeatBrowser(btn, "classFeat");
  });

  // Create class feature from class group sub-header (pre-assigns class association)
  reg.on.data("action", "create-class-feature-for").click(async (e, actor) => {
    const btn = e.target.closest("[data-action='create-class-feature-for']");
    const className = btn?.dataset.className;
    const data = { type: "feat", name: "New Class Feature", system: { subType: "classFeat" } };
    if (className) data.system.associations = { classes: [className] };
    const [item] = await actor.createEmbeddedDocuments("Item", [data]);
    item?.sheet.render(true);
  });

  // Browse class features from class group sub-header
  reg.on.data("action", "browse-class-feature-for").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-class-feature-for']");
    openFeatBrowser(btn, "classFeat");
  });

  // Create unslotted feat from section header
  reg.on.data("action", "create-other-feat").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Feat", system: { subType: "feat" } }]);
    item?.sheet.render(true);
  });

  // Browse feats from section header
  reg.on.data("action", "browse-other-feat").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-other-feat']");
    openFeatBrowser(btn, "feat");
  });

  // Use/activate item
  reg.on.data("action", "use-feature").click((e, actor) => {
    const id = e.target.closest("[data-item-id]")?.dataset.itemId;
    const item = actor.items.get(id);
    if (item) item.use({ skipDialog: e.shiftKey });
  });

  // Edit item
  reg.on.data("action", "edit-feature").click((e, actor) => {
    const id = e.target.closest("[data-item-id]")?.dataset.itemId;
    actor.items.get(id)?.sheet.render(true);
  });

  // Delete item
  reg.on.data("action", "delete-feature").click((e, actor) => {
    const id = e.target.closest("[data-item-id]")?.dataset.itemId;
    if (id) actor.deleteEmbeddedDocuments("Item", [id]);
  });

  // Create feat for level slot
  reg.on.data("action", "create-level-feat").click(async (e, actor) => {
    const btn = e.target.closest("[data-action='create-level-feat']");
    const level = parseSlotLevel(btn?.dataset.slotLevel);
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Feat", system: { subType: "feat" } }]);
    if (!item) return;
    await addToSlots(actor, "levelFeatSlots", level, item.id);
    item.sheet.render(true);
  });

  // Browse feat for level slot — popup drop target + open PF1e browser
  reg.on.data("action", "browse-level-feat").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-level-feat']");
    const level = parseSlotLevel(btn?.dataset.slotLevel);
    showSlotPopup(btn, actor, "Level", level, async (item) => {
      await addToSlots(actor, "levelFeatSlots", level, item.id);
    });
    openFeatBrowser(btn, "feat");
  });

  // Create feat for bonus feat slot
  reg.on.data("action", "create-bonus-feat").click(async (e, actor) => {
    const btn = e.target.closest("[data-action='create-bonus-feat']");
    const granterId = btn?.dataset.granterId;
    const level = parseSlotLevel(btn?.dataset.slotLevel);
    const granterItem = actor.items.get(granterId);
    if (!granterItem) return;
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Feat", system: { subType: "feat" } }]);
    if (!item) return;
    await addToSlots(granterItem, "bonusFeatSlots", level, item.id);
    item.sheet.render(true);
  });

  // Browse feat for bonus feat slot — popup drop target + open PF1e browser
  reg.on.data("action", "browse-bonus-feat").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-bonus-feat']");
    const granterId = btn?.dataset.granterId;
    const level = parseSlotLevel(btn?.dataset.slotLevel);
    const label = btn?.dataset.groupLabel ?? "Bonus Feat";
    const granterItem = actor.items.get(granterId);
    if (!granterItem) return;
    showSlotPopup(btn, actor, label, level, async (item) => {
      await addToSlots(granterItem, "bonusFeatSlots", level, item.id);
    });
    openFeatBrowser(btn, "feat");
  });

  // Create trait from section header
  reg.on.data("action", "create-other-trait").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Trait", system: { subType: "trait" } }]);
    item?.sheet.render(true);
  });

  // Browse traits from section header
  reg.on.data("action", "browse-other-trait").click((e, actor) => {
    openFeatBrowser(e.target.closest("[data-action='browse-other-trait']"), "trait");
  });

  // Create trait for trait slot
  reg.on.data("action", "create-trait-slot").click(async (e, actor) => {
    const btn = e.target.closest("[data-action='create-trait-slot']");
    const slotIdx = parseInt(btn?.dataset.slotIdx);
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Trait", system: { subType: "trait" } }]);
    if (!item) return;
    await addToSlots(actor, "traitSlots", null, item.id);
    item.sheet.render(true);
  });

  // Browse trait for trait slot
  reg.on.data("action", "browse-trait-slot").click((e, actor) => {
    const btn = e.target.closest("[data-action='browse-trait-slot']");
    showSlotPopup(btn, actor, "Trait", null, async (item) => {
      await addToSlots(actor, "traitSlots", null, item.id);
    }, "trait");
    openFeatBrowser(btn, "trait");
  });

  // Drag other-trait rows
  reg.on.data("drag-source", "other-trait").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
  });

  // Create racial trait
  reg.on.data("action", "create-racial-trait").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Racial Trait", system: { subType: "racial" } }]);
    item?.sheet.render(true);
  });

  // Browse racial traits
  reg.on.data("action", "browse-racial-trait").click((e, actor) => {
    openFeatBrowser(e.target.closest("[data-action='browse-racial-trait']"), "racial");
  });

  // Drag racial trait rows
  reg.on.data("drag-source", "racial-trait").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
  });

  // Reorder racial traits by dropping onto another racial trait row
  reg.on("[data-body-id='racial-body'] [data-drag-source='racial-trait']").dragover((e) => {
    e.preventDefault();
  });

  reg.on("[data-body-id='racial-body'] [data-drag-source='racial-trait']").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const srcItem = actor.items.find(i => i.uuid === data.uuid);
    if (!srcItem || srcItem.system?.subType !== "racial") return;
    const targetRow = e.target.closest("[data-item-id]");
    const targetItem = targetRow ? actor.items.get(targetRow.dataset.itemId) : null;
    if (!targetItem || targetItem.id === srcItem.id) return;
    const siblings = actor.items.filter(i => i.type === "feat" && i.system.subType === "racial" && i.id !== srcItem.id);
    const rect = targetRow.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const updates = SortingHelpers.performIntegerSort(srcItem, { target: targetItem, siblings, sortKey: "sort", insertBefore: before });
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates.map(({ target, update }) => ({ _id: target.id, ...update })));
  });

  // Templates
  reg.on.data("action", "create-template").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Template", system: { subType: "template" } }]);
    item?.sheet.render(true);
  });
  reg.on.data("action", "browse-template").click((e, actor) => {
    openFeatBrowser(e.target.closest("[data-action='browse-template']"), "template");
  });
  reg.on.data("drag-source", "template-feat").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
  });
  reg.on("[data-body-id='templates-body'] [data-drag-source='template-feat']").dragover((e) => { e.preventDefault(); });
  reg.on("[data-body-id='templates-body'] [data-drag-source='template-feat']").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const srcItem = actor.items.find(i => i.uuid === data.uuid);
    if (!srcItem || srcItem.system?.subType !== "template") return;
    const targetRow = e.target.closest("[data-item-id]");
    const targetItem = targetRow ? actor.items.get(targetRow.dataset.itemId) : null;
    if (!targetItem || targetItem.id === srcItem.id) return;
    const siblings = actor.items.filter(i => i.type === "feat" && i.system.subType === "template" && i.id !== srcItem.id);
    const rect = targetRow.getBoundingClientRect();
    const updates = SortingHelpers.performIntegerSort(srcItem, { target: targetItem, siblings, sortKey: "sort", insertBefore: e.clientY < rect.top + rect.height / 2 });
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates.map(({ target, update }) => ({ _id: target.id, ...update })));
  });

  // Miscellaneous
  reg.on.data("action", "create-misc").click(async (e, actor) => {
    const [item] = await actor.createEmbeddedDocuments("Item", [{ type: "feat", name: "New Feature", system: { subType: "misc" } }]);
    item?.sheet.render(true);
  });
  reg.on.data("action", "browse-misc").click((e, actor) => {
    openFeatBrowser(e.target.closest("[data-action='browse-misc']"), "misc");
  });
  reg.on.data("drag-source", "misc-feat").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
  });
  reg.on("[data-body-id='misc-body'] [data-drag-source='misc-feat']").dragover((e) => { e.preventDefault(); });
  reg.on("[data-body-id='misc-body'] [data-drag-source='misc-feat']").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const srcItem = actor.items.find(i => i.uuid === data.uuid);
    if (!srcItem || srcItem.system?.subType !== "misc") return;
    const targetRow = e.target.closest("[data-item-id]");
    const targetItem = targetRow ? actor.items.get(targetRow.dataset.itemId) : null;
    if (!targetItem || targetItem.id === srcItem.id) return;
    const siblings = actor.items.filter(i => i.type === "feat" && i.system.subType === "misc" && i.id !== srcItem.id);
    const rect = targetRow.getBoundingClientRect();
    const updates = SortingHelpers.performIntegerSort(srcItem, { target: targetItem, siblings, sortKey: "sort", insertBefore: e.clientY < rect.top + rect.height / 2 });
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates.map(({ target, update }) => ({ _id: target.id, ...update })));
  });

  // Drag class feature rows — encode ctrl intent for child association
  reg.on.data("drag-source", "class-feature").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid, isChildAssoc: e.ctrlKey }));
  });

  // Drop onto a class feature row — reassign class; Ctrl also sets parent-child
  reg.on("[data-drag-source='class-feature']").dragover((e) => { e.preventDefault(); });

  reg.on("[data-drag-source='class-feature']").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const srcItem = actor.items.find(i => i.uuid === data.uuid);
    const targetRow = e.target.closest("[data-item-id]");
    const targetId = targetRow?.dataset.itemId;
    if (!srcItem || !targetId) return;
    const className = targetRow.dataset.className;
    const classTag = targetRow.dataset.classTag;
    // Reassign to the target row's class (skip if no real class, e.g. Other group)
    if (className && classTag) {
      await srcItem.update({
        "system.associations.classes": [className],
        "system.class": classTag,
      });
    }
    // Ctrl+drag → also parent this item under the target feature
    if (data.isChildAssoc && srcItem.id !== targetId) {
      await srcItem.setFlag(MODULE, "parentFeatureId", targetId);
    }
  });

  // Remove parent-child association
  reg.on.data("action", "unparent-feature").click(async (e, actor) => {
    const id = e.target.closest("[data-item-id]")?.dataset.itemId;
    const item = actor.items.get(id);
    if (item) await item.unsetFlag(MODULE, "parentFeatureId");
  });

  // Drop onto class header
  reg.on("[data-drop-class]").dragover((e) => {
    e.preventDefault();
    e.target.closest("[data-drop-class]")?.classList.add("drag-over");
  });

  reg.on("[data-drop-class]").dragleave((e) => {
    e.target.closest("[data-drop-class]")?.classList.remove("drag-over");
  });

  reg.on("[data-drop-class]").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const source = await fromUuid(data.uuid);
    if (!source) return;
    const item = source.parent === actor ? source : actor.items.get(source.id);
    if (!item) return;
    const header = e.target.closest("[data-drop-class]");
    const className = header.dataset.dropClass;
    const classTag = header.dataset.dropClassTag ?? "";
    const updates = { "system.associations.classes": [className] };
    if (classTag) updates["system.class"] = classTag;
    await item.update(updates);
  });

  // Drag start from Feats: Other rows
  reg.on.data("drag-source", "other-feat").dragstart((e, actor) => {
    const row = e.target.closest("[data-item-id]");
    if (!row) return;
    const item = actor.items.get(row.dataset.itemId);
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid: item.uuid }));
  });

  // Auto-populate classFeatureLevel from class associations when item is created
  Hooks.on("createItem", async (item, _options, userId) => {
    if (game.userId !== userId) return;
    if (!item.parent || item.parent.documentName !== "Actor") return;
    if (item.type !== "feat" || item.system.subType !== "classFeat") return;
    if (item.getFlag(MODULE, "classFeatureLevel") != null) return;

    const sourceId = item._stats?.compendiumSource;
    if (!sourceId) return;

    const actor = item.parent;
    const classTag = item.system.class;
    if (!classTag) return;

    const classItem = actor.items.find(i => i.type === "class" && i.system.tag === classTag);
    if (!classItem) return;

    const assocs = classItem.system.links?.classAssociations ?? [];
    const match = assocs.find(a => a.uuid === sourceId);
    if (match?.level == null) return;

    await item.setFlag(MODULE, "classFeatureLevel", match.level);
  });

  // Drag start from filled slot rows — encode item uuid + source slot so it can be cleared on move
  reg.on.data("drag-source", "slot-feat").dragstart((e, actor) => {
    const row = e.target.closest("[data-drag-source='slot-feat']");
    if (!row) return;
    // Find the item id from the edit button in the controls
    const editBtn = row.querySelector("[data-action='edit-feature'][data-item-id]");
    const itemId = editBtn?.dataset.itemId;
    const item = itemId ? actor.items.get(itemId) : null;
    if (!item) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({
      type: "Item",
      uuid: item.uuid,
      srcFlagKey: row.dataset.slotTarget,
      srcLevel: row.dataset.slotLevel ?? null,
      srcGranterId: row.dataset.granterId ?? null,
    }));
  });

  // Drop onto a slot row
  reg.on("[data-slot-target]").dragover((e) => { e.preventDefault(); });

  reg.on("[data-slot-target]").drop(async (e, actor) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item") return;
    const item = await resolveDroppedItem(data, actor);
    const row = e.target.closest("[data-slot-target]");
    const slotSubType = row?.dataset.slotSubtype ?? "feat";
    if (!item || item.system?.subType !== slotSubType) return;
    const flagKey = row.dataset.slotTarget;
    const level = parseSlotLevel(row.dataset.slotLevel);
    const granterId = row.dataset.granterId;
    const flagTarget = granterId ? actor.items.get(granterId) : actor;
    if (!flagTarget) return;
    await addToSlots(flagTarget, flagKey, level, item.id);
    // If dragged from another slot, clear the source slot
    if (data.srcFlagKey) {
      const srcLevel = parseSlotLevel(data.srcLevel);
      const srcFlagTarget = data.srcGranterId ? actor.items.get(data.srcGranterId) : actor;
      if (srcFlagTarget) {
        const slots = [...(srcFlagTarget.getFlag(MODULE, data.srcFlagKey) ?? [])];
        const idx = srcLevel !== null
          ? slots.findIndex(s => s.level === srcLevel && s.itemId === item.id)
          : slots.findIndex(s => s.itemId === item.id);
        if (idx >= 0) {
          if (srcLevel !== null) slots[idx] = { level: srcLevel, itemId: null };
          else slots.splice(idx, 1);
          await srcFlagTarget.setFlag(MODULE, data.srcFlagKey, slots);
        }
      }
    }
  });
}
