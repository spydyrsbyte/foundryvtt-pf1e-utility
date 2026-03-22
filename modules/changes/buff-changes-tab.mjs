function flagLabel(key, cfg) {
  return typeof cfg === "string" ? cfg : (cfg?.label ?? key);
}

function getBonusTypeLabel(key) {
  const val = pf1?.config?.bonusTypes?.[key];
  return typeof val === "string" ? val : (val?.label ?? key);
}

function loc(key) {
  if (!key) return key;
  return key.startsWith("PF1.") ? (game.i18n.localize(key) ?? key) : key;
}

function buildTargetTree(targets, categories) {
  const catMap = new Map();
  for (const [key, tgt] of Object.entries(targets)) {
    const catId = tgt.category ?? "misc";
    if (!catMap.has(catId)) {
      const catCfg = categories[catId];
      catMap.set(catId, {
        id: catId,
        label: loc(catCfg?.label ?? catId),
        children: [],
      });
    }
    catMap.get(catId).children.push({ id: key, label: loc(tgt.label ?? key), isFlag: false });
  }
  for (const cat of catMap.values()) {
    cat.children.sort((a, b) => a.label.localeCompare(b.label));
  }
  return Array.from(catMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildChangesTree(targets, categories, flagDefs) {
  const tree = buildTargetTree(targets, categories);
  const flagLeaves = Object.entries(flagDefs)
    .map(([key, cfg]) => ({ id: key, label: flagLabel(key, cfg), isFlag: true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (flagLeaves.length) tree.push({ id: "flags", label: "Flags", children: flagLeaves });
  return tree;
}

function buildNotesTree() {
  const targets = pf1?.config?.contextNoteTargets ?? {};
  const categories = pf1?.config?.contextNoteCategories ?? {};
  return buildTargetTree(targets, categories);
}

function buildChangesContext(item, Changes) {
  const actor = item.parent ?? null;
  const targets = Changes.getTargets(actor);
  const categories = Changes.getCategories(actor);
  const flagDefs = pf1?.config?.changeFlags ?? {};

  const changesTree = buildChangesTree(targets, categories, flagDefs);
  const notesTree = buildNotesTree();

  const rawChanges = Array.from(item.system.changes ?? []);
  const changes = rawChanges.map((ch, idx) => {
    const targetKey = ch.target ?? "";
    const type = ch.type ?? "untyped";
    const formula = ch.formula ?? "";
    return {
      idx,
      target: targetKey,
      category: targets[targetKey]?.category ?? "misc",
      label: ch.label || targets[targetKey]?.label || targetKey,
      formula,
      formulaDisplay: formula || "(formula)",
      type,
      typeName: getBonusTypeLabel(type),
      priority: ch.priority ?? 0,
      isAdd: ch.operator !== "set",
      isSet: ch.operator === "set",
    };
  });

  const changeFlags = item.system.changeFlags ?? {};
  const flags = Object.entries(changeFlags)
    .filter(([, val]) => val === true)
    .map(([key]) => ({ key, label: flagLabel(key, flagDefs[key]) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const rawNotes = Array.from(item.system.contextNotes ?? []);
  const notes = rawNotes.map((note, idx) => {
    const targetKey = note.target ?? "";
    const text = note.text ?? "";
    return {
      idx,
      target: targetKey,
      targetLabel: loc((pf1?.config?.contextNoteTargets ?? {})[targetKey]?.label) || targetKey || "(no target)",
      text,
      textDisplay: text || "(note text)",
    };
  });

  return { changesTree, notesTree, changes, flags, notes };
}

const SETTING_KEY = "useCustomChangesTab";

export function initializeBuffChangesTab(ItemSheet, Changes) {
  game.settings.register("pf1e-utility", SETTING_KEY, {
    name: "Use Custom Changes Tab",
    hint: "Replace the native Changes tab with the enhanced Modifiers/Context tab. Disable to revert to the original.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  const reg = ItemSheet.tabs.new({
    id: "pf1e-util-changes",
    label: "Changes",
    subtypes: "*",
    replaces: "changes",
    enabled: () => game.settings.get("pf1e-utility", SETTING_KEY),
    template: "modules/pf1e-utility/templates/buff-changes-tab.hbs",
    data: (item) => buildChangesContext(item, Changes),
  });

  // Sub-tab switching
  reg.on(".pf1e-util-subtab").click((e) => {
    const btn = e.target.closest(".pf1e-util-subtab");
    const tab = e.target.closest(".pf1e-util-changes-tab");
    const subtab = btn?.dataset.subtab;
    if (!tab || !subtab) return;
    tab.dataset.subtab = subtab;
    tab.querySelectorAll(".pf1e-util-subtab").forEach((b) =>
      b.classList.toggle("active", b.dataset.subtab === subtab)
    );
  });

  // Category expand/collapse
  reg.on(".pf1e-util-tree-cat").click((e) => {
    const cat = e.target.closest(".pf1e-util-tree-cat");
    const id = cat?.dataset.catId;
    const treeEl = e.target.closest(".pf1e-util-changes-tree");
    const children = treeEl?.querySelector(`.pf1e-util-tree-children[data-parent="${id}"]`);
    if (children) children.classList.toggle("open");
  });

  // Drag start
  reg.on("[draggable='true']").dragstart((e) => {
    const el = e.target.closest("[draggable='true']");
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ target: el.dataset.target, isFlag: el.dataset.isFlag === "true" })
    );
  });

  // Allow drop on modifiers content
  reg.on(".pf1e-util-content-modifiers").dragover((e) => { e.preventDefault(); });

  // Drop on modifiers: create change or enable flag
  reg.on(".pf1e-util-content-modifiers").drop(async (e, item) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
    catch { return; }
    if (data.isFlag) {
      await item.update({ [`system.changeFlags.${data.target}`]: true });
    } else {
      const changes = item.toObject().system.changes ?? [];
      changes.push({ formula: "", operator: "add", target: data.target, type: "untyped", priority: 0 });
      await item.update({ "system.changes": changes });
    }
  });

  // Allow drop on context notes content
  reg.on(".pf1e-util-content-context").dragover((e) => { e.preventDefault(); });

  // Drop on context: create context note
  reg.on(".pf1e-util-content-context").drop(async (e, item) => {
    e.preventDefault();
    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); }
    catch { return; }
    if (data.isFlag) return;
    const notes = item.toObject().system.contextNotes ?? [];
    notes.push({ text: "", target: data.target });
    await item.update({ "system.contextNotes": notes });
  });

  // Operator toggle — add
  reg.on.data("action", "op-add").click((e, item) => {
    const idx = parseInt(e.target.closest("[data-idx]").dataset.idx);
    const changes = item.toObject().system.changes ?? [];
    if (changes[idx] != null) { changes[idx].operator = "add"; item.update({ "system.changes": changes }); }
  });

  // Operator toggle — set
  reg.on.data("action", "op-set").click((e, item) => {
    const idx = parseInt(e.target.closest("[data-idx]").dataset.idx);
    const changes = item.toObject().system.changes ?? [];
    if (changes[idx] != null) { changes[idx].operator = "set"; item.update({ "system.changes": changes }); }
  });

  // Type click-to-edit → dropdown built in JS
  reg.on.data("action", "type-edit").click((e, item) => {
    const span = e.target.closest("[data-action='type-edit']");
    if (!span || span.tagName !== "SPAN") return;
    const idx = parseInt(span.dataset.idx);
    const currentType = span.dataset.currentType;

    const rawBonusTypes = pf1?.config?.bonusTypes ?? {};
    const select = document.createElement("select");
    select.className = "pf1e-util-type-select";
    for (const [key, val] of Object.entries(rawBonusTypes)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = typeof val === "string" ? val : (val?.label ?? key);
      if (key === currentType) opt.selected = true;
      select.append(opt);
    }
    span.replaceWith(select);
    select.focus();

    select.addEventListener("blur", () => {
      const key = select.value;
      const span2 = document.createElement("span");
      span2.className = "pf1e-util-type-label pf1e-util-editable-label";
      span2.dataset.action = "type-edit";
      span2.dataset.idx = idx;
      span2.dataset.currentType = key;
      span2.title = "Click to change type";
      span2.textContent = getBonusTypeLabel(key);
      select.replaceWith(span2);
      const changes = item.toObject().system.changes ?? [];
      if (changes[idx] != null) { changes[idx].type = key; item.update({ "system.changes": changes }); }
    }, { once: true });
  });

  // Priority click-to-edit
  reg.on.data("action", "priority-edit").click((e, item) => {
    const span = e.target.closest("[data-action='priority-edit']");
    if (!span || span.tagName !== "SPAN") return;
    const idx = parseInt(span.dataset.idx);
    const input = document.createElement("input");
    input.type = "number";
    input.value = span.textContent.trim();
    input.className = "pf1e-util-priority-input";
    span.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("blur", () => {
      const val = parseInt(input.value) || 0;
      const span2 = document.createElement("span");
      span2.className = "pf1e-util-priority pf1e-util-editable-label";
      span2.dataset.action = "priority-edit";
      span2.dataset.idx = idx;
      span2.title = "Click to edit priority";
      span2.textContent = val;
      input.replaceWith(span2);
      const changes = item.toObject().system.changes ?? [];
      if (changes[idx] != null) { changes[idx].priority = val; item.update({ "system.changes": changes }); }
    }, { once: true });
  });

  // Formula click-to-edit (row 2)
  reg.on.data("action", "formula-edit").click((e, item) => {
    const span = e.target.closest("[data-action='formula-edit']");
    if (!span || span.tagName !== "SPAN") return;
    const idx = parseInt(span.dataset.idx);
    const input = document.createElement("input");
    input.type = "text";
    input.value = span.dataset.formula ?? "";
    input.className = "pf1e-util-formula-input";
    span.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("blur", () => {
      const val = input.value.trim();
      const span2 = document.createElement("span");
      span2.className = "pf1e-util-formula-label pf1e-util-editable-label";
      span2.dataset.action = "formula-edit";
      span2.dataset.idx = idx;
      span2.dataset.formula = val;
      span2.title = "Click to edit formula";
      span2.textContent = val || "(formula)";
      input.replaceWith(span2);
      const changes = item.toObject().system.changes ?? [];
      if (changes[idx] != null) { changes[idx].formula = val; item.update({ "system.changes": changes }); }
    }, { once: true });
  });

  // Delete change
  reg.on.data("action", "delete-change").click((e, item) => {
    const btn = e.target.closest("[data-action='delete-change']");
    const idx = parseInt(btn.dataset.idx);
    const changes = item.toObject().system.changes ?? [];
    changes.splice(idx, 1);
    item.update({ "system.changes": changes });
  });

  // Delete flag
  reg.on.data("action", "delete-flag").click((e, item) => {
    const btn = e.target.closest("[data-action='delete-flag']");
    const key = btn.dataset.flagKey;
    item.update({ [`system.changeFlags.${key}`]: false });
  });

  // Note text click-to-edit (textarea)
  reg.on.data("action", "note-edit").click((e, item) => {
    const span = e.target.closest("[data-action='note-edit']");
    if (!span || span.tagName !== "SPAN") return;
    const idx = parseInt(span.dataset.idx);
    const ta = document.createElement("textarea");
    ta.value = span.dataset.text ?? "";
    ta.className = "pf1e-util-note-textarea";
    ta.rows = 3;
    span.replaceWith(ta);
    ta.focus();
    ta.addEventListener("blur", () => {
      const val = ta.value.trim();
      const span2 = document.createElement("span");
      span2.className = "pf1e-util-note-text pf1e-util-editable-label";
      span2.dataset.action = "note-edit";
      span2.dataset.idx = idx;
      span2.dataset.text = val;
      span2.title = "Click to edit";
      span2.textContent = val || "(note text)";
      ta.replaceWith(span2);
      const notes = item.toObject().system.contextNotes ?? [];
      if (notes[idx] != null) { notes[idx].text = val; item.update({ "system.contextNotes": notes }); }
    }, { once: true });
  });

  // Delete note
  reg.on.data("action", "delete-note").click((e, item) => {
    const btn = e.target.closest("[data-action='delete-note']");
    const idx = parseInt(btn.dataset.idx);
    const notes = item.toObject().system.contextNotes ?? [];
    notes.splice(idx, 1);
    item.update({ "system.contextNotes": notes });
  });
}
