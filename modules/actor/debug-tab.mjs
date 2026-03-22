function buildTree(value, key = null, depth = 0) {
  const isObj = value !== null && typeof value === "object";
  const isArray = Array.isArray(value);
  const label = key !== null ? `<span class="obj-key">${key}</span><span class="obj-colon">: </span>` : "";

  if (!isObj) {
    const cls = value === null ? "obj-null" : `obj-${typeof value}`;
    const display = value === null ? "null" : String(value);
    return `<div class="obj-leaf">${label}<span class="${cls}">${display}</span></div>`;
  }

  const entries = isArray ? [...value.entries()] : Object.entries(value);
  const summary = isArray ? `Array(${value.length})` : `{${entries.length}}`;
  const children = entries.map(([k, v]) => buildTree(v, k, depth + 1)).join("");

  return `<div class="obj-node${depth === 0 ? " obj-root" : ""}">
    <div class="obj-header" data-action="obj-toggle">
      <i class="fa-solid fa-caret-right obj-caret"></i>
      ${label}<span class="obj-summary">${summary}</span>
    </div>
    <div class="obj-children">${children}</div>
  </div>`;
}

export function registerDebugTab(ActorSheet) {
  const tab = ActorSheet.tabs.new({
    id: "pf1e-util-debug",
    label: "Debug",
    template: "modules/pf1e-utility/templates/actor-debug.hbs",
    data: (actor) => ({ tree: buildTree(actor.toObject()) }),
    hidden: true,
  });

  tab.on.data("action", "obj-toggle").click((e) => {
    const node = e.target.closest(".obj-node");
    if (!node) return;
    node.classList.toggle("obj-open");
  });
}
