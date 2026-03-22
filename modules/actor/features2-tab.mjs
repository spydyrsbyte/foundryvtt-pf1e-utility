import { DataGrid } from '../item-grid/item-grid.mjs';

const MODULE = 'pf1e-utility';
const LEVEL_FORMULA_KEY = 'levelFeatFormula';
const TRAIT_COUNT_KEY = 'traitCount';

// ─────────────────────────────────────────────────────────────────────────────
// Data helpers  (mirrors features-tab.mjs — shared logic, separate rendering)
// ─────────────────────────────────────────────────────────────────────────────

function isStaticFormula(formula) {
  const t = String(formula ?? '').trim();
  return t !== '' && !isNaN(Number(t));
}

function findTicks(formula, maxLevel, makeData) {
  const ticks = [];
  let prev = 0;
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const substituted = Roll.replaceFormulaData(formula, makeData(lvl), { missing: '0' });
    let result = 0;
    try { result = Math.max(0, Math.floor(Roll.safeEval(substituted) ?? 0)); } catch { result = 0; }
    while (result > prev) { ticks.push(lvl); prev++; }
  }
  return ticks;
}

function itemColumns(item) {
  if (!item) return { abilityType: '', hasCharges: false, chargesVal: null, chargesMax: null, hasAction: false };
  const aType = item.system.abilityType ?? '';
  const aTypeLabel = pf1.config.abilityTypes[aType]?.short ?? aType;
  const uses = item.system.uses ?? null;
  const chargesMax = uses?.max ?? null;
  const hasCharges = chargesMax !== null && chargesMax !== 0;
  return {
    abilityType: aTypeLabel,
    hasCharges, chargesVal: uses?.value ?? null, chargesMax,
    hasAction: (item.system.actions?.length ?? 0) > 0,
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
  const actorClassNames = new Set(actor.items.filter(i => i.type === 'class').map(i => i.name));
  const classMap = new Map();
  for (const classItem of actor.items.filter(i => i.type === 'class')) {
    classMap.set(classItem.name, { name: classItem.name, tag: classItem.system.tag ?? '', level: classItem.system.level ?? null, sort: classItem.sort, features: [], isOther: false });
  }
  for (const item of actor.items) {
    if (item.type !== 'feat' || item.system.subType !== 'classFeat') continue;
    const className = item.system.associations?.classes?.[0];
    const groupKey = (className && actorClassNames.has(className)) ? className : 'Other';
    if (!classMap.has(groupKey)) {
      const classItem = groupKey !== 'Other' ? actor.items.find(i => i.type === 'class' && i.name === groupKey) : null;
      classMap.set(groupKey, { name: groupKey, tag: classItem?.system.tag ?? '', level: classItem?.system.level ?? null, sort: classItem?.sort ?? Infinity, features: [], isOther: groupKey === 'Other' });
    }
    classMap.get(groupKey).features.push({
      id: item.id, name: item.name, img: item.img,
      featureLevel: item.getFlag(MODULE, 'classFeatureLevel') ?? '',
      parentFeatureId: item.getFlag(MODULE, 'parentFeatureId') ?? null,
      sort: item.sort, children: [],
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
      if (f.parentFeatureId && byId.has(f.parentFeatureId)) byId.get(f.parentFeatureId).children.push(f);
      else roots.push(f);
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
  const stored = actor.getFlag(MODULE, 'levelFeatSlots') ?? [];
  if (isStaticFormula(formula)) return resolveSlots([], true, parseInt(formula) || 0, stored, actor);
  const ticks = findTicks(formula, charLevel, lvl => ({ details: { level: { value: lvl } } }));
  return resolveSlots(ticks, false, 0, stored, actor);
}

function buildBonusFeatGroups(actor) {
  const groups = [];
  for (const item of actor.items) {
    const bonusChange = (item.system.changes ?? []).find(ch => ch.target === 'bonusFeats');
    if (!bonusChange) continue;
    const className = item.system.associations?.classes?.[0] ?? null;
    const classItem = className ? actor.items.find(i => i.type === 'class' && i.name === className) : null;
    const classLevel = classItem?.system.level ?? 0;
    const formula = bonusChange.formula ?? '';
    const stored = item.getFlag(MODULE, 'bonusFeatSlots') ?? [];
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
    .filter(i => i.type === 'feat' && i.system.subType === 'feat' && !slotted.has(i.id))
    .map(i => ({ id: i.id, name: i.name, img: i.img, sort: i.sort, ...itemColumns(i) }))
    .sort((a, b) => a.sort - b.sort);
}

function buildTraitSlots(actor) {
  const count = game.settings.get(MODULE, TRAIT_COUNT_KEY);
  const stored = actor.getFlag(MODULE, 'traitSlots') ?? [];
  return resolveSlots([], true, count, stored, actor);
}

function buildOtherTraits(actor, traitSlots) {
  const slotted = new Set(traitSlots.filter(s => s.itemId).map(s => s.itemId));
  return actor.items
    .filter(i => i.type === 'feat' && i.system.subType === 'trait' && !slotted.has(i.id))
    .map(i => ({ id: i.id, name: i.name, img: i.img, sort: i.sort, ...itemColumns(i) }))
    .sort((a, b) => a.sort - b.sort);
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

async function removeFromSlot(flagTarget, flagKey, level, itemId) {
  const slots = [...(flagTarget.getFlag(MODULE, flagKey) ?? [])];
  const idx = level !== null
    ? slots.findIndex(s => s.level === level && s.itemId === itemId)
    : slots.findIndex(s => s.itemId === itemId);
  if (idx < 0) return;
  if (level !== null) slots[idx] = { level, itemId: null };
  else slots[idx] = { ...slots[idx], itemId: null };
  await flagTarget.setFlag(MODULE, flagKey, slots);
}

async function openFeatBrowser(anchor, subType = null) {
  const sheet = anchor.closest('.app.sheet') ?? anchor.closest('.window-app');
  const sheetZ = sheet ? (parseInt(getComputedStyle(sheet).zIndex) || 0) : 0;
  const browseCfg = subType ? pf1.config.sheetSections?.features?.[subType]?.browse : null;
  const category = browseCfg?.category ?? 'feats';
  const browser = pf1.applications.compendiums[category];
  if (!browser) return;
  if (browseCfg) {
    const filters = {};
    for (const [k, v] of Object.entries(browseCfg)) {
      if (k === 'category' || k === 'level') continue;
      filters[k] = Array.isArray(v) ? [v] : [v];
    }
    if (Object.keys(filters).length) browser._queueFilters(filters);
  }
  await browser._render(true, { focus: true });
  const el = browser.element?.[0] ?? browser.element;
  if (el) el.style.zIndex = sheetZ + 2;
}

function parseSlotLevel(val) {
  return (!val || val === 'null' || val === '') ? null : parseInt(val);
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid construction helpers
// ─────────────────────────────────────────────────────────────────────────────

function mkFa(name, faname, width, options = {}) {
  const ctrl = new DataGrid.Fontawesome(name, MODULE, { faname, fastyle: 'solid', ...options });
  if (width !== 'flex') ctrl.width = width;
  return ctrl;
}

function mkLbl(name, value, width = 'flex') {
  const ctrl = new DataGrid.Label(name, MODULE, { value });
  if (width !== 'flex') ctrl.width = width;
  return ctrl;
}

function mkImg(name, value = '{{img}}') {
  const ctrl = new DataGrid.Image(name, MODULE, { value });
  ctrl.width = 24;
  return ctrl;
}

function mkCollapse(name) {
  const ctrl = new DataGrid.Collapse(name, MODULE);
  ctrl.width = 16;
  return ctrl;
}

/** Muted label (AT / charges columns) matching the features-tab colour. */
function mkMuted(name, value, width) {
  const ctrl = mkLbl(name, value, width);
  ctrl.cssclass = 'pf1e-util-ig-col-muted';
  return ctrl;
}

/** Column header icon using a PF1 SVG mask — fixed width, no interaction. */
function mkColIcon(name, maskUrl, width, title = '') {
  const ctrl = new DataGrid.Label(name, MODULE, {
    value: `<span class="pf1e-util-ig-col-icon" style="mask-image:url('${maskUrl}')" title="${title}"></span>`,
    cssclass: 'pf1e-util-ig-col-hdr',
  });
  ctrl.width = width;
  return ctrl;
}

/** Alternating even-row highlight via JS (CSS :nth-child can't skip body divs). */
function mkAlt(name) {
  return new DataGrid.StyleAlternating(name, MODULE, { even: 'pf1e-util-ig-row-alt' });
}

// Makes an item row draggable and sets dataTransfer on dragstart.
function mkDrag(name) {
  const ctrl = new DataGrid.Drag(name, MODULE);
  ctrl.onDragStart = (_actor, item, _data, row, e) => {
    if (!item) { e.preventDefault(); return; }
    const src = slotMeta(row);
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: 'Item', uuid: item.uuid,
      srcFlagKey: src.flagKey, srcLevel: src.level, srcGranterId: src.granterId,
    }));
  };
  return ctrl;
}

// Makes a slot item row a drop target for feat/trait slot assignment.
function mkDrop(name) {
  const ctrl = new DataGrid.Drop(name, MODULE);
  ctrl.onDragOver = (_actor, _item, _data, row, e) => {
    const { flagKey } = slotMeta(row);
    if (flagKey) e.preventDefault();
  };
  ctrl.onDrop = async (actor, _item, _data, row, e) => {
    const { flagKey, level, granterId } = slotMeta(row);
    if (!flagKey) return;
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (data?.type !== 'Item') return;
    const source = await fromUuid(data.uuid);
    if (!source) return;
    const dropped = source.parent === actor
      ? source
      : (await actor.createEmbeddedDocuments('Item', [source.toObject()]))[0];
    if (!dropped) return;
    const subType = flagKey.includes('trait') ? 'trait' : 'feat';
    if (dropped.system?.subType !== subType) return;
    const flagTarget = granterId ? actor.items.get(granterId) : actor;
    if (!flagTarget) return;
    await addToSlots(flagTarget, flagKey, level, dropped.id);
    if (data.srcFlagKey) {
      const srcFlagTarget = data.srcGranterId ? actor.items.get(data.srcGranterId) : actor;
      if (srcFlagTarget) await removeFromSlot(srcFlagTarget, data.srcFlagKey, data.srcLevel, dropped.id);
    }
  };
  return ctrl;
}

function slotMeta(row) {
  const ds = row?.dataset ?? {};
  return {
    flagKey:   ds.flagKey   ?? null,
    level:     parseSlotLevel(ds.slotLevel),
    granterId: ds.granterId && ds.granterId !== 'null' ? ds.granterId : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared column widths — must match between header icons and item cells
// ─────────────────────────────────────────────────────────────────────────────
const W_LEVEL   = 36;
const W_AT      = 30;
const W_CHARGES = 60;
const W_BTN     = 18;  // edit, del, unparent-spacer, use, add, browse

// PF1 system icon paths
const ICON_AT      = "systems/pf1/icons/actions/magic-palm.svg";
const ICON_CHARGES = "systems/pf1/icons/actions/battery-pack.svg";
const ICON_ACTION  = "systems/pf1/icons/actions/gears.svg";

// ─────────────────────────────────────────────────────────────────────────────
// Build the DataGrid
// ─────────────────────────────────────────────────────────────────────────────

function buildGrid() {
  const { ItemDataGrid, ItemDataGridSection } = DataGrid;
  const grid = new ItemDataGrid('features2');
  grid.alternatingClass = ['', 'pf1e-util-ig-row-alt'];

  // ── Shared per-item handlers ───────────────────────────────────────────────

  function wireItemRow(imgCtrl, editCtrl, delCtrl, useCtrl) {
    imgCtrl.onClick   = (_actor, item) => item?.sheet.render(true);
    editCtrl.onClick  = (_actor, item) => item?.sheet.render(true);
    editCtrl.cellClass = 'ig-row-btn';
    delCtrl.onClick   = (actor, item) => { if (item) actor.deleteEmbeddedDocuments('Item', [item.id]); };
    delCtrl.cellClass  = 'ig-row-btn';
    useCtrl.onClick   = (_actor, item, _data, _row, e) => item?.use({ skipDialog: e.shiftKey });
  }

  function wireCollapse(row) {
    row.events.click = (_actor, _item, _data, rowEl, e) => {
      if (e.target.closest('i, button, input, select')) return;
      row.toggleCollapse(rowEl);
    };
  }

  // ── CLASS FEATURES ─────────────────────────────────────────────────────────
  const cfSec = new ItemDataGridSection();

  const cfAdd    = mkFa('cfAdd',    'plus',         W_BTN, { title: 'Create Class Feature' });
  const cfBrowse = mkFa('cfBrowse', 'folder-plus',  W_BTN, { title: 'Browse Class Features' });
  cfAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Class Feature', system: { subType: 'classFeat' } }]);
    item?.sheet.render(true);
  };
  cfBrowse.onClick = (_actor, _item, _data, _row, e) => openFeatBrowser(e.target, 'classFeat');

  cfSec.header.controls
    .add(mkCollapse('cfColH'))
    .add(mkLbl('cfTitle', 'Class Features ({{count}})'))
    .add(mkColIcon('cfHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('cfHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(cfAdd)
    .add(cfBrowse)
    .add(mkColIcon('cfHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const cfAddFor    = mkFa('cfAddFor',    'plus',        W_BTN, { title: 'Create feature for this class' });
  const cfBrowseFor = mkFa('cfBrowseFor', 'folder-plus', W_BTN, { title: 'Browse features for this class' });
  cfAddFor.onClick = async (actor, _item, data) => {
    const className = data.row.rowId;
    const itemData  = { type: 'feat', name: 'New Class Feature', system: { subType: 'classFeat' } };
    if (className) {
      itemData.system.associations = { classes: [className] };
      const cls = actor.items.find(i => i.type === 'class' && i.name === className);
      if (cls?.system.tag) itemData.system.class = cls.system.tag;
    }
    const [item] = await actor.createEmbeddedDocuments('Item', [itemData]);
    item?.sheet.render(true);
  };
  cfBrowseFor.onClick = (_actor, _item, _data, _row, e) => openFeatBrowser(e.target, 'classFeat');

  cfSec.subheader.controls
    .add(mkCollapse('cfColS'))
    .add(mkLbl('cfSubName', '{{name}}{{#if level}} (Lvl {{level}}){{/if}}'))
    .add(mkLbl('cfShAT',      '', W_AT))
    .add(mkLbl('cfShCharges', '', W_CHARGES))
    .add(cfAddFor)
    .add(cfBrowseFor)
    .add(mkLbl('cfShAction', '', W_BTN));

  const cfFeatLvl = new DataGrid.LabelEdit('cfFeatLvl', MODULE, {
    value: '{{featureLevel}}', filter: /^\d*$/, title: 'Click to edit level gained',
  });
  cfFeatLvl.width = W_LEVEL;
  cfFeatLvl.onChange = async (_actor, item, _data, _row, e) => {
    if (!item) return;
    const val = e.target.value.trim();
    await item.setFlag(MODULE, 'classFeatureLevel', val === '' ? null : parseInt(val));
  };

  const cfImg  = mkImg('cfImg');
  const cfUse  = mkFa('cfUse',  'dice-d20',      W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const cfEdit = mkFa('cfEdit', 'pen-to-square',  W_BTN, { title: 'Edit' });
  const cfDel  = mkFa('cfDel',  'trash',          W_BTN, { title: 'Delete' });
  wireItemRow(cfImg, cfEdit, cfDel, cfUse);

  cfSec.item.controls
    .add(mkDrag('cfDrag'))
    .add(mkAlt('cfAlt'))
    .add(cfFeatLvl).add(cfImg)
    .add(mkLbl('cfName', '{{name}}'))
    .add(mkMuted('cfAT', '{{abilityType}}', W_AT))
    .add(mkMuted('cfCharges', '{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}', W_CHARGES))
    .add(cfEdit).add(cfDel).add(cfUse);

  // Ctrl+drag an item onto another to make it a child
  cfSec.item.events.dragover = (_actor, item, _data, _row, e) => {
    if (!e.ctrlKey || !item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
  };
  cfSec.item.events.drop = async (actor, item, _data, _row, e) => {
    if (!e.ctrlKey || !item) return;
    e.preventDefault();
    let drag;
    try { drag = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (drag?.type !== 'Item') return;
    const source = await fromUuid(drag.uuid);
    if (!source) return;
    const dragged = source.parent === actor ? source : null;
    if (!dragged || dragged.id === item.id) return;
    await dragged.setFlag(MODULE, 'parentFeatureId', item.id);
  };

  const cfSubFeatLvl = new DataGrid.LabelEdit('cfSubFeatLvl', MODULE, {
    value: '{{featureLevel}}', filter: /^\d*$/, title: 'Click to edit level gained',
  });
  cfSubFeatLvl.width = W_LEVEL;
  cfSubFeatLvl.onChange = cfFeatLvl.onChange;

  // Tree line doubles as the unparent button (hover shows fa-link-slash icon via CSS)
  const cfTree = new DataGrid.TreeLine('cfTree', MODULE);
  cfTree.onClick = async (_actor, item) => { if (item) await item.unsetFlag(MODULE, 'parentFeatureId'); };

  const cfSubImg   = mkImg('cfSubImg');
  const cfSubUse   = mkFa('cfSubUse',  'dice-d20',     W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const cfSubEdit  = mkFa('cfSubEdit', 'pen-to-square', W_BTN, { title: 'Edit' });
  const cfSubDel   = mkFa('cfSubDel',  'trash',         W_BTN, { title: 'Delete' });
  wireItemRow(cfSubImg, cfSubEdit, cfSubDel, cfSubUse);

  cfSec.subitem.controls
    .add(mkDrag('cfSubDrag'))
    .add(mkAlt('cfSubAlt'))
    .add(cfTree)
    .add(cfSubFeatLvl).add(cfSubImg)
    .add(mkLbl('cfSubName2', '{{name}}'))
    .add(mkMuted('cfSubAT', '{{abilityType}}', W_AT))
    .add(mkMuted('cfSubCharges', '{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}', W_CHARGES))
    .add(cfSubEdit).add(cfSubDel).add(cfSubUse);

  wireCollapse(cfSec.header); wireCollapse(cfSec.subheader);
  grid.addSection('classFeatures', cfSec);

  // ── FEATS ──────────────────────────────────────────────────────────────────
  const ftSec = new ItemDataGridSection();

  const ftAdd    = mkFa('ftAdd',    'plus',        W_BTN, { title: 'Create Feat' });
  const ftBrowse = mkFa('ftBrowse', 'folder-plus', W_BTN, { title: 'Browse Feats' });
  ftAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Feat', system: { subType: 'feat' } }]);
    item?.sheet.render(true);
  };
  ftBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'feat');

  ftSec.header.controls
    .add(mkCollapse('ftColH'))
    .add(mkLbl('ftTitle', 'Feats ({{count}})'))
    .add(mkColIcon('ftHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('ftHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(ftAdd).add(ftBrowse)
    .add(mkColIcon('ftHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const ftShAdd    = mkFa('ftShAdd',    'plus',        W_BTN, { title: 'Create Feat' });
  const ftShBrowse = mkFa('ftShBrowse', 'folder-plus', W_BTN, { title: 'Browse Feats' });
  ftShAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Feat', system: { subType: 'feat' } }]);
    item?.sheet.render(true);
  };
  ftShBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'feat');

  ftSec.subheader.controls
    .add(mkCollapse('ftColS'))
    .add(mkLbl('ftGroupLabel', '{{name}}'))
    .add(mkLbl('ftShAT',      '', W_AT))
    .add(mkLbl('ftShCharges', '', W_CHARGES))
    .add(ftShAdd).add(ftShBrowse)
    .add(mkLbl('ftShAction', '', W_BTN));

  const ftImg        = mkImg('ftImg', '{{#if filled}}{{itemImg}}{{else}}icons/svg/item-bag.svg{{/if}}');
  const ftUse        = mkFa('ftUse',  'dice-d20',      W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const ftEdit       = mkFa('ftEdit', 'pen-to-square',  W_BTN, { title: 'Edit' });
  const ftDel        = mkFa('ftDel',  'trash',          W_BTN, { title: 'Delete' });
  const ftSlotAdd    = mkFa('ftSlotAdd',    'plus',        W_BTN, { title: 'Create feat for slot' });
  const ftSlotBrowse = mkFa('ftSlotBrowse', 'folder-plus', W_BTN, { title: 'Browse feats for slot' });
  wireItemRow(ftImg, ftEdit, ftDel, ftUse);

  ftSlotAdd.onClick = async (actor, _item, _data, row) => {
    const { flagKey, level, granterId } = slotMeta(row);    if (!flagKey) return;
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Feat', system: { subType: 'feat' } }]);
    if (!item) return;
    const flagTarget = granterId ? actor.items.get(granterId) : actor;
    if (flagTarget) await addToSlots(flagTarget, flagKey, level, item.id);
    item.sheet.render(true);
  };
  ftSlotBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'feat');

  const ftPanel = new DataGrid.TogglePanel('ftPanel', MODULE, { value: 'filled' });
  const ftSlotSpacer = new DataGrid.Spacer('ftSlotSpacer', MODULE); ftSlotSpacer.width = W_BTN;
  ftPanel.addPanel(true,  [ftEdit, ftDel, ftUse]);
  ftPanel.addPanel(false, [ftSlotAdd, ftSlotBrowse, ftSlotSpacer]);

  ftSec.item.controls
    .add(mkDrag('ftDrag'))
    .add(mkDrop('ftDrop'))
    .add(mkAlt('ftAlt'))
    .add(mkLbl('ftLevel', '{{#if level}}{{level}}{{/if}}', W_LEVEL))
    .add(ftImg)
    .add(mkLbl('ftName', '{{#if filled}}{{itemName}}{{else}}<em>Empty</em>{{/if}}'))
    .add(mkMuted('ftAT', '{{#if filled}}{{abilityType}}{{/if}}', W_AT))
    .add(mkMuted('ftCharges', '{{#if filled}}{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}{{/if}}', W_CHARGES))
    .add(new DataGrid.RowData('ftSlotInfo', MODULE, { fields: { flagKey: '{{slotFlagKey}}', slotLevel: '{{slotLevel}}', granterId: '{{slotGranterId}}' } }))
    .add(ftPanel);

  wireCollapse(ftSec.header); wireCollapse(ftSec.subheader);
  grid.addSection('feats', ftSec);

  // ── TRAITS ─────────────────────────────────────────────────────────────────
  const trSec = new ItemDataGridSection();

  const trAdd    = mkFa('trAdd',    'plus',        W_BTN, { title: 'Create Trait' });
  const trBrowse = mkFa('trBrowse', 'folder-plus', W_BTN, { title: 'Browse Traits' });
  trAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Trait', system: { subType: 'trait' } }]);
    item?.sheet.render(true);
  };
  trBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'trait');

  trSec.header.controls
    .add(mkCollapse('trColH'))
    .add(mkLbl('trTitle', 'Traits ({{count}})'))
    .add(mkColIcon('trHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('trHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(trAdd).add(trBrowse)
    .add(mkColIcon('trHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const trShAdd    = mkFa('trShAdd',    'plus',        W_BTN, { title: 'Create Trait' });
  const trShBrowse = mkFa('trShBrowse', 'folder-plus', W_BTN, { title: 'Browse Traits' });
  trShAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Trait', system: { subType: 'trait' } }]);
    item?.sheet.render(true);
  };
  trShBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'trait');

  trSec.subheader.controls
    .add(mkCollapse('trColS'))
    .add(mkLbl('trGroupLabel', '{{name}}'))
    .add(mkLbl('trShAT',      '', W_AT))
    .add(mkLbl('trShCharges', '', W_CHARGES))
    .add(trShAdd).add(trShBrowse)
    .add(mkLbl('trShAction', '', W_BTN));

  const trImg        = mkImg('trImg', '{{#if filled}}{{itemImg}}{{else}}icons/svg/item-bag.svg{{/if}}');
  const trUse        = mkFa('trUse',  'dice-d20',    W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const trEdit       = mkFa('trEdit', 'pen-to-square', W_BTN, { title: 'Edit' });
  const trDel        = mkFa('trDel',  'trash',         W_BTN, { title: 'Delete' });
  const trSlotAdd    = mkFa('trSlotAdd',    'plus',        W_BTN, { title: 'Create trait for slot' });
  const trSlotBrowse = mkFa('trSlotBrowse', 'folder-plus', W_BTN, { title: 'Browse traits for slot' });
  wireItemRow(trImg, trEdit, trDel, trUse);

  trSlotAdd.onClick = async (actor, _item, _data, row) => {
    const { flagKey, level } = slotMeta(row);    if (!flagKey) return;
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Trait', system: { subType: 'trait' } }]);
    if (!item) return;
    await addToSlots(actor, flagKey, level, item.id);
    item.sheet.render(true);
  };
  trSlotBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'trait');

  const trPanel = new DataGrid.TogglePanel('trPanel', MODULE, { value: 'filled' });
  const trSlotSpacer = new DataGrid.Spacer('trSlotSpacer', MODULE); trSlotSpacer.width = W_BTN;
  trPanel.addPanel(true,  [trEdit, trDel, trUse]);
  trPanel.addPanel(false, [trSlotAdd, trSlotBrowse, trSlotSpacer]);

  trSec.item.controls
    .add(mkDrag('trDrag'))
    .add(mkDrop('trDrop'))
    .add(mkAlt('trAlt'))
    .add(trImg)
    .add(mkLbl('trName', '{{#if filled}}{{itemName}}{{else}}<em>Empty</em>{{/if}}'))
    .add(mkMuted('trAT', '{{#if filled}}{{abilityType}}{{/if}}', W_AT))
    .add(mkMuted('trCharges', '{{#if filled}}{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}{{/if}}', W_CHARGES))
    .add(new DataGrid.RowData('trSlotInfo', MODULE, { fields: { flagKey: '{{slotFlagKey}}', slotLevel: '{{slotLevel}}' } }))
    .add(trPanel);

  wireCollapse(trSec.header); wireCollapse(trSec.subheader);
  grid.addSection('traits', trSec);

  // ── RACIAL TRAITS ──────────────────────────────────────────────────────────
  const raSec = new ItemDataGridSection();

  const raAdd    = mkFa('raAdd',    'plus',        W_BTN, { title: 'Create Racial Trait' });
  const raBrowse = mkFa('raBrowse', 'folder-plus', W_BTN, { title: 'Browse Racial Traits' });
  raAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Racial Trait', system: { subType: 'racial' } }]);
    item?.sheet.render(true);
  };
  raBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'racial');

  raSec.header.controls
    .add(mkCollapse('raColH'))
    .add(mkLbl('raTitle', 'Racial Traits'))
    .add(mkColIcon('raHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('raHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(raAdd).add(raBrowse)
    .add(mkColIcon('raHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const raImg  = mkImg('raImg');
  const raUse  = mkFa('raUse',  'dice-d20',    W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const raEdit = mkFa('raEdit', 'pen-to-square', W_BTN, { title: 'Edit' });
  const raDel  = mkFa('raDel',  'trash',         W_BTN, { title: 'Delete' });
  const raLvlSpacer = new DataGrid.Spacer('raLvlSpacer', MODULE); raLvlSpacer.width = W_LEVEL;
  wireItemRow(raImg, raEdit, raDel, raUse);

  raSec.item.controls
    .add(mkDrag('raDrag'))
    .add(mkAlt('raAlt'))
    .add(raLvlSpacer).add(raImg)
    .add(mkLbl('raName', '{{name}}'))
    .add(mkMuted('raAT', '{{abilityType}}', W_AT))
    .add(mkMuted('raCharges', '{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}', W_CHARGES))
    .add(raEdit).add(raDel).add(raUse);

  wireCollapse(raSec.header);
  grid.addSection('racial', raSec);

  // ── TEMPLATES ──────────────────────────────────────────────────────────────
  const tmSec = new ItemDataGridSection();

  const tmAdd    = mkFa('tmAdd',    'plus',        W_BTN, { title: 'Create Template' });
  const tmBrowse = mkFa('tmBrowse', 'folder-plus', W_BTN, { title: 'Browse Templates' });
  tmAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Template', system: { subType: 'template' } }]);
    item?.sheet.render(true);
  };
  tmBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'template');

  tmSec.header.controls
    .add(mkCollapse('tmColH'))
    .add(mkLbl('tmTitle', 'Templates'))
    .add(mkColIcon('tmHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('tmHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(tmAdd).add(tmBrowse)
    .add(mkColIcon('tmHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const tmImg  = mkImg('tmImg');
  const tmUse  = mkFa('tmUse',  'dice-d20',    W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const tmEdit = mkFa('tmEdit', 'pen-to-square', W_BTN, { title: 'Edit' });
  const tmDel  = mkFa('tmDel',  'trash',         W_BTN, { title: 'Delete' });
  const tmLvlSpacer = new DataGrid.Spacer('tmLvlSpacer', MODULE); tmLvlSpacer.width = W_LEVEL;
  wireItemRow(tmImg, tmEdit, tmDel, tmUse);

  tmSec.item.controls
    .add(mkDrag('tmDrag'))
    .add(mkAlt('tmAlt'))
    .add(tmLvlSpacer).add(tmImg)
    .add(mkLbl('tmName', '{{name}}'))
    .add(mkMuted('tmAT', '{{abilityType}}', W_AT))
    .add(mkMuted('tmCharges', '{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}', W_CHARGES))
    .add(tmEdit).add(tmDel).add(tmUse);

  wireCollapse(tmSec.header);
  grid.addSection('templates', tmSec);

  // ── MISCELLANEOUS ──────────────────────────────────────────────────────────
  const miSec = new ItemDataGridSection();

  const miAdd    = mkFa('miAdd',    'plus',        W_BTN, { title: 'Create Feature' });
  const miBrowse = mkFa('miBrowse', 'folder-plus', W_BTN, { title: 'Browse Features' });
  miAdd.onClick    = async (actor) => {
    const [item] = await actor.createEmbeddedDocuments('Item', [{ type: 'feat', name: 'New Feature', system: { subType: 'misc' } }]);
    item?.sheet.render(true);
  };
  miBrowse.onClick = (_a, _i, _d, _r, e) => openFeatBrowser(e.target, 'misc');

  miSec.header.controls
    .add(mkCollapse('miColH'))
    .add(mkLbl('miTitle', 'Miscellaneous'))
    .add(mkColIcon('miHdrAT',      ICON_AT,      W_AT,      'Ability Type'))
    .add(mkColIcon('miHdrCharges', ICON_CHARGES, W_CHARGES, 'Charges'))
    .add(miAdd).add(miBrowse)
    .add(mkColIcon('miHdrAction',  ICON_ACTION,  W_BTN,     'Action'));

  const miImg  = mkImg('miImg');
  const miUse  = mkFa('miUse',  'dice-d20',    W_BTN, { cssclass: '{{#unless hasAction}}f2-hidden{{/unless}}', title: 'Use' });
  const miEdit = mkFa('miEdit', 'pen-to-square', W_BTN, { title: 'Edit' });
  const miDel  = mkFa('miDel',  'trash',         W_BTN, { title: 'Delete' });
  const miLvlSpacer = new DataGrid.Spacer('miLvlSpacer', MODULE); miLvlSpacer.width = W_LEVEL;
  wireItemRow(miImg, miEdit, miDel, miUse);

  miSec.item.controls
    .add(mkDrag('miDrag'))
    .add(mkAlt('miAlt'))
    .add(miLvlSpacer).add(miImg)
    .add(mkLbl('miName', '{{name}}'))
    .add(mkMuted('miAT', '{{abilityType}}', W_AT))
    .add(mkMuted('miCharges', '{{#if hasCharges}}{{chargesVal}}/{{chargesMax}}{{/if}}', W_CHARGES))
    .add(miEdit).add(miDel).add(miUse);

  wireCollapse(miSec.header);
  grid.addSection('misc', miSec);

  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data function
// ─────────────────────────────────────────────────────────────────────────────

function buildGridData(actor) {
  const levelSlots      = buildLevelSlots(actor);
  const bonusFeatGroups = buildBonusFeatGroups(actor);
  const traitSlots      = buildTraitSlots(actor);
  const classes         = buildClassGroups(actor);
  const otherFeats      = buildOtherFeats(actor, levelSlots, bonusFeatGroups);
  const otherTraits     = buildOtherTraits(actor, traitSlots);
  const racialTraits    = actor.items.filter(i => i.type === 'feat' && i.system.subType === 'racial')
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));
  const templates       = actor.items.filter(i => i.type === 'feat' && i.system.subType === 'template')
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));
  const miscFeatures    = actor.items.filter(i => i.type === 'feat' && i.system.subType === 'misc')
    .map(i => ({ id: i.id, name: i.name, img: i.img, ...itemColumns(i) }));

  const classesCount = classes.reduce((sum, c) => sum + c.features.length, 0);
  const featsCount   = levelSlots.filter(s => s.filled).length
    + bonusFeatGroups.reduce((sum, g) => sum + g.slots.filter(s => s.filled).length, 0)
    + otherFeats.length;
  const traitsCount  = traitSlots.filter(s => s.filled).length + otherTraits.length;

  function slotItem(slot, i, flagKey, granterId = null) {
    return {
      _id:           slot.itemId ?? `empty-${flagKey}-${slot.level ?? i}`,
      itemImg:       slot.itemImg,
      itemName:      slot.itemName,
      filled:        slot.filled,
      level:         slot.level,
      abilityType:   slot.filled ? slot.abilityType : '',
      hasCharges:    slot.filled ? slot.hasCharges : false,
      chargesVal:    slot.chargesVal,
      chargesMax:    slot.chargesMax,
      hasAction:     slot.filled ? slot.hasAction : false,
      slotFlagKey:   flagKey,
      slotLevel:     slot.level,
      slotGranterId: granterId,
    };
  }

  function featItem(f) {
    return {
      _id:           f.id,
      itemImg:       f.img,
      itemName:      f.name,
      filled:        true,
      level:         null,
      abilityType:   f.abilityType,
      hasCharges:    f.hasCharges,
      chargesVal:    f.chargesVal,
      chargesMax:    f.chargesMax,
      hasAction:     f.hasAction,
      slotFlagKey:   null,
      slotLevel:     null,
      slotGranterId: null,
    };
  }

  return {
    classFeatures: {
      count: classesCount,
      _subheaders: classes.map(cls => ({
        _id: cls.name,
        name: cls.name,
        level: cls.level,
        _items: cls.features.map(feat => ({
          _id:          feat.id,
          img:          feat.img,
          name:         feat.name,
          abilityType:  feat.abilityType,
          hasCharges:   feat.hasCharges,
          chargesVal:   feat.chargesVal,
          chargesMax:   feat.chargesMax,
          hasAction:    feat.hasAction,
          featureLevel: feat.featureLevel,
          _children: feat.children.map(child => ({
            _id:          child.id,
            img:          child.img,
            name:         child.name,
            abilityType:  child.abilityType,
            hasCharges:   child.hasCharges,
            chargesVal:   child.chargesVal,
            chargesMax:   child.chargesMax,
            hasAction:    child.hasAction,
            featureLevel: child.featureLevel,
          })),
        })),
      })),
    },

    feats: {
      count: featsCount,
      _subheaders: [
        {
          _id:   'level',
          name:  `Level Feats (${levelSlots.filter(s => s.filled).length}/${levelSlots.length})`,
          _items: levelSlots.map((s, i) => slotItem(s, i, 'levelFeatSlots')),
        },
        ...bonusFeatGroups.map(g => ({
          _id:   `bonus-${g.granterId}`,
          name:  g.label,
          _items: g.slots.map((s, i) => slotItem(s, i, 'bonusFeatSlots', g.granterId)),
        })),
        {
          _id:   'other',
          name:  'Other Feats',
          _items: otherFeats.map(featItem),
        },
      ],
    },

    traits: {
      count: traitsCount,
      _subheaders: [
        {
          _id:   'slots',
          name:  `Trait Slots (${traitSlots.filter(s => s.filled).length}/${traitSlots.length})`,
          _items: traitSlots.map((s, i) => slotItem(s, i, 'traitSlots')),
        },
        {
          _id:   'other',
          name:  'Other Traits',
          _items: otherTraits.map(featItem),
        },
      ],
    },

    racial: {
      _items: racialTraits.map(t => ({
        _id: t.id, img: t.img, name: t.name,
        abilityType: t.abilityType, hasCharges: t.hasCharges,
        chargesVal: t.chargesVal, chargesMax: t.chargesMax, hasAction: t.hasAction,
      })),
    },

    templates: {
      _items: templates.map(t => ({
        _id: t.id, img: t.img, name: t.name,
        abilityType: t.abilityType, hasCharges: t.hasCharges,
        chargesVal: t.chargesVal, chargesMax: t.chargesMax, hasAction: t.hasAction,
      })),
    },

    misc: {
      _items: miscFeatures.map(m => ({
        _id: m.id, img: m.img, name: m.name,
        abilityType: m.abilityType, hasCharges: m.hasCharges,
        chargesVal: m.chargesVal, chargesMax: m.chargesMax, hasAction: m.hasAction,
      })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab registration
// ─────────────────────────────────────────────────────────────────────────────

export function initializeFeatures2Tab(ActorSheet) {
  game.settings.register(MODULE, LEVEL_FORMULA_KEY, {
    name: "Level Feat Formula",
    hint: "Formula for feats gained by character level. Use @details.level.value for character level.",
    scope: "world",
    config: true,
    type: String,
    default: "ceil(@details.level.value / 2)",
  });

  game.settings.register(MODULE, TRAIT_COUNT_KEY, {
    name: "Trait Count",
    hint: "Number of trait slots available to characters.",
    scope: "world",
    config: true,
    type: Number,
    default: 2,
  });

  const grid = buildGrid();
  grid.data = buildGridData;

  ActorSheet.tabs.new({
    id: 'pf1e-util-features',
    label: 'Features',
    template: 'modules/pf1e-utility/templates/actor-features2-tab.hbs',
    data: (actor) => ({ actor }),
    order: { after: 'inventory' },
    render: (actor, pane) => grid.render(actor, pane),
  });
}
