export const DataGrid = {};

/**
 * Top-level grid. Owns sections and the data function.
 *
 * Data function signature: (actor, name) => Object
 * Return structure:
 * {
 *   [sectionName]: {
 *     // header-level cell values
 *     _subheaders: [
 *       {
 *         _id: string,
 *         // subheader-level cell values
 *         _items: [
 *           {
 *             _id: string,   // REQUIRED
 *             // item-level cell values
 *             _children: [  // optional
 *               { _id: string, /* subitem cell values *\/ }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * }
 */
class ItemDataGrid {
  /** @type {string} */
  name = '';

  /** @type {Map<string, ItemDataGridSection>} */
  #sections = new Map();

  /** @type {(actor: object, name: string) => Object} */
  data = (_actor, _name) => ({});

  /**
   * Classes to cycle across rows within each body container.
   * Empty array = no alternating. 2+ entries = cycle by row index.
   * e.g. ['', 'pf1e-util-ig-row-alt'] → even rows get no class, odd rows get the alt class.
   * @type {string[]}
   */
  alternatingClass = [];

  addSection(name, section) {
    this.#sections.set(name, section);
    return this;
  }

  /**
   * @param {object} actor
   * @param {HTMLElement} element
   */
  #scrollTop = 0;

  render(actor, element) {
    const compiled = Handlebars.compile(this.#buildRootTemplate());
    element.innerHTML = compiled(this.data(actor, this.name));
    const igEl = element.querySelector('.pf1e-util-ig');
    if (igEl) {
      const saved = this.#scrollTop;
      requestAnimationFrame(() => { igEl.scrollTop = saved; });
      igEl.addEventListener('scroll', () => { this.#scrollTop = igEl.scrollTop; }, { passive: true });
    }

    for (const [sectionName, section] of this.#sections) {
      section._hookEvents(element, sectionName, actor);
    }

    // Alternating rows: cycle through alternatingClass across item/subitem rows
    // in each body container, skipping interleaved body divs that would break :nth-child.
    if (this.alternatingClass.length >= 2) {
      const classes = this.alternatingClass;
      const rows = [...element.querySelectorAll('[data-row-type="item"], [data-row-type ="subitem"]')];
      rows.forEach((row, i) => {
        row.classList.remove(...classes.filter(Boolean));
        const cls = classes[i % classes.length];
        if (cls) row.classList.add(cls);
      });
    }
  }

  #buildRootTemplate() {
    const parts = ['<div class="pf1e-util-ig">'];
    for (const [sectionName, section] of this.#sections) {
      parts.push(section._buildSectionTemplate(sectionName));
    }
    parts.push('</div>');
    return parts.join('\n');
  }

  constructor(name) {
    this.name = name;
  }
}
DataGrid.ItemDataGrid = ItemDataGrid;

class ItemDataGridStyle{

}


class ItemDataGridStyle_Control extends ItemDataGridStyle{

}
class ItemDataGridStyle_Row extends ItemDataGridStyle{


}


/** Shared context resolver used by all overriding hookEvents implementations. */
function resolveEventContext(e, actor) {
  const row = e.target.closest('[data-row-type]');
  if (!row) return null;
  const data = { row: { ...row.dataset }, cell: { ...e.target.dataset } };
  const item = data.row.rowId ? actor.items.get(data.row.rowId) : undefined;
  return { actor, item, data, row, e };
}


/**
 * Defines 4 row layouts for a section.
 * Row templates are inlined into the section template at build time
 * by substituting %body-header%, %body-subheader%, %body-item% placeholders.
 */
class ItemDataGridSection {
  header    = new ItemDataGridRow('header');
  subheader = new ItemDataGridRow('subheader');
  item      = new ItemDataGridRow('item');
  subitem   = new ItemDataGridRow('subitem');

  _hookEvents(element, sectionName, actor) {
    const sectionEl = element.querySelector(`[data-section-id="${sectionName}"]`) ?? element;
    this.header._hookEvents(sectionEl, actor);
    this.subheader._hookEvents(sectionEl, actor);
    this.item._hookEvents(sectionEl, actor);
    this.subitem._hookEvents(sectionEl, actor);
  }

  _buildSectionTemplate(sectionName) {
    // Build inside-out, substituting %body-X% placeholders with child iteration blocks.

    // Subitem — leaf row, no children
    const subitemTpl = this.subitem._renderTemplate();

    // Item — children are subitems
    const itemChildBlock = `{{#each _children}}${subitemTpl}{{/each}}`;
    const itemTpl = this.item._renderTemplate().replace('%body-item%', itemChildBlock);

    // Items iteration block (reused by subheader and header direct-items)
    const itemsIter = `{{#each _items}}${itemTpl}{{/each}}`;

    // Subheader — children are items
    const subheaderTpl = this.subheader._renderTemplate().replace('%body-subheader%', itemsIter);

    // Header — children are subheaders followed by direct items
    const headerChildBlock = `{{#each _subheaders}}${subheaderTpl}{{/each}}${itemsIter}`;
    const headerTpl = this.header._renderTemplate().replace('%body-header%', headerChildBlock);

    return `{{#with ${sectionName}}}<div class="pf1e-util-ig-section" data-section-id="${sectionName}">${headerTpl}</div>{{/with}}`;
  }
}
DataGrid.ItemDataGridSection = ItemDataGridSection;


/**
 * A row definition — an ordered collection of controls (cells).
 * Each control owns its own width and cssclass.
 */
class ItemDataGridRow {
  #controls = new ItemDataGridControlCollection();
  #rowType = 'item';
  #renderHasNoChildren = true;
  get renderHasNoChildren(){
    return this.#renderHasNoChildren;
  }
  get controls() { return this.#controls; }
  set rowType(rt){
    if(typeof  rt  == 'string' ){
      switch(rt){
        case 'item' :
        case 'subitem' :
        case  'header' :
        case 'subheader' :
          this.#rowType = rt;
          break
        default:
          // Do nothing leave as is

      }
    }else if(typeof rt === 'number'){
      switch(rt){
        case 0 :
          this.#rowType = 'header';
          break;
        case 1 :
          this.#rowType = 'subheader';
          break;
        case 2 :
          this.#rowType = 'item';
          break;
        case 3 :
          this.#rowType = 'subitem';
          break;
        default:
          //Do Nothing leave as is
      }
    }
  }

  #getChildrenTypes(){
    const ct = [];
    switch(this.#rowType){
        case 'item' :
          ct.push('_children')
          break;
        case  'header' :
          ct.push('_subheaders');
        case 'subheader' :
          ct.push('_items')
          break
        default:
          // Do nothing leave as is
    }
    return ct;
  }

  #generateTemplate(){
    const children = this.#getChildrenTypes()
    let body = ''
    let renderNoChildren = `{{#if (or ${children.join(' ')})}}`
    let renderNoChildrenClose = '{{/if}}'



    if(children.length > 0){



      body = `
        ${renderNoChildren}
        <div class="pf1e-util-ig-${this.#rowType}-body"  data-body-type ="${this.#rowType}">
            %body-${this.#rowType}%
        </div>
        ${renderNoChildrenClose}
      `
    }
    if(this.#renderHasNoChildren){
      renderNoChildren = '';
      renderNoChildrenClose = '';
    }

    return `
      ${renderNoChildren}
      <div class="pf1e-util-ig-${this.#rowType}" data-row-type="${this.#rowType}" data-row-id="{{_id}}">
        ${this.#controls._renderTemplate()}
      </div>
      ${body}
      ${renderNoChildrenClose}
    `
  }

  _renderTemplate() {
 

    return this.#generateTemplate();
  }
  
  events = {
    click:       undefined,
    contextmenu: undefined,
    mouseenter:  undefined,
    mouseleave:  undefined,
    mousedown:   undefined,
    mouseup:     undefined,
    dragstart:   undefined,
    dragend:     undefined,
    dragover:    undefined,
    drop:        undefined,
  };

  /**
   * Toggle the collapsed state of this row's body.
   * Syncs the collapse control's caret icons if present.
   * @param {HTMLElement} rowEl - The rendered row div.
   */
  toggleCollapse(rowEl) {
    if (!rowEl) return;
    const next = rowEl.nextElementSibling;
    const body = next?.classList.contains(`pf1e-util-ig-${this.#rowType}-body`) ? next : null;
    if (!body) return;
    const collapsed = body.classList.toggle('pf1e-util-ig-collapsed');
    const collapseEl = rowEl.querySelector('.pf1e-util-ig-collapse');
    if (collapseEl) {
      collapseEl.querySelector('.pf1e-util-ig-collapse-closed').style.display = collapsed ? '' : 'none';
      collapseEl.querySelector('.pf1e-util-ig-collapse-open').style.display   = collapsed ? 'none' : '';
    }
  }

  _hookEvents(element, actor) {
    this.#controls._hookEvents(element, actor);

    const bound = Object.entries(this.events).filter(([, fn]) => typeof fn === 'function');
    if (!bound.length) return;

    element.querySelectorAll(`[data-row-type="${this.#rowType}"]`).forEach(row => {
      for (const [event, fn] of bound) {
        row.addEventListener(event, (e) => {
          const data = { row: { ...row.dataset }, cell: { ...e.target.dataset } };
          const item = data.row.rowId ? actor.items.get(data.row.rowId) : undefined;
          fn(actor, item, data, row, e);
        });
      }
    });
  }

  constructor(rowType) {
    if (rowType !== undefined) this.rowType = rowType;
  }
}
DataGrid.ItemDataGridRow = ItemDataGridRow;


class ItemDataGridControlCollection {
  #controls = [];

  add(control) {
    if (!(control instanceof ItemDataGrid_Control)) {
      throw new Error(`ItemDataGridControlCollection: must be an ItemDataGrid_Control instance`);
    }
    if (control.name.startsWith('_')) {
      throw new Error(`ItemDataGridControlCollection: control name "${control.name}" cannot start with '_'`);
    }
    this.#controls.push(control);
    return this;
  }

  _renderTemplate() {
    return this.#controls.map(c => c.renderCell()).join('');
  }

  _hookEvents(element,actor) {
    for (const control of this.#controls) {
      control.hookEvents(element,actor);
    }
  }
}


class ItemDataGrid_Control {
  #id = '';
  #name = '';
  #module = '';

  get name()   { return this.#name; }
  get id()     { return this.#id; }

  /** @type {'flex'|number} */
  width     = 'flex';
  /** @type {number} Horizontal padding in px added inside the cell on each side. */
  padding   = 0;
  /** @type {string} CSS classes applied to the outer cell span only (not the inner element). */
  cellClass = '';
  cssclass  = '';
  title    = '';

  events = {
    click:       'onClick',
    mouseenter:  'onMouseEnter',
    mouseleave:  'onMouseLeave',
    mouseover:   'onMouseOver',
    mouseout:    undefined,
    mousedown:   'onMouseDown',
    mouseup:     'onMouseUp',
    mousemove:   'onMouseMove',
    focus:       undefined,
    blur:        undefined,
    keydown:     undefined,
    keyup:       undefined,
    keypress:    undefined,
    dragstart:   undefined,
    dragend:     undefined,
    dragover:    undefined,
    drop:        undefined,
    contextmenu: undefined,
    touchstart:  undefined,
    touchend:    undefined,
    touchmove:   undefined,
    change:      undefined,
  };
  data = {

  }
  renderTemplateArgs() {

    return {
      id:         this.#id     ? ` data-id="${this.#id}"`                                 : '',
      name:       this.#name   ? ` data-name="${this.#name}"`                             : '',
      module:     this.#module ? ` data-module="${this.#module}"`                         : '',
      cssclass:   this.cssclass || '',
      title:      this.title   ? ` data-title="${this.title}" title="${this.title}"`      : '',
      customdata: Object.entries(this.data).map(([k, v]) => ` data-custom-${k}="${v}"`).join(''),
    };
  }

  /** Override in subclasses — returns the inner HBS string for this control. */
  renderTemplate() {
    return '';
  }

  /** Wraps renderTemplate() in a cell span with this control's width and padding.
   *  cellClass goes on the outer span; cssclass goes on the inner element only. */
  renderCell() {
    const p = this.padding ? `;padding:0 ${this.padding}px` : '';
    const style = this.width === 'flex'
      ? `flex:1${p}`
      : `width:${this.width}px;flex:0 0 ${this.width}px${p}`;
    return `<span class="pf1e-util-ig-cell ${this.cellClass}" style="${style}">${this.renderTemplate()}</span>`;
  }

  hookEvents(element,actor) {
    if (!this.#id) return;
    const els = element.querySelectorAll(`[data-id="${this.#id}"]`);
    if (!els.length) return;
    const bound = {};
    for (const [event, handlerName] of Object.entries(this.events)) {
      if (handlerName && typeof this[handlerName] === 'function') {
        bound[event] = this[handlerName].bind(this);
      }
    }
    els.forEach(el => {
      for (const [event, fn] of Object.entries(bound)) {
        const fun = (e) => {
          const row = e.target.closest('[data-row-type]');
          if (!row) return;
          const data = {
              row:{ ...row.dataset}
              ,cell:{...e.target.dataset }};
          const item = data.row.rowId ? actor.items.get(data.row.rowId) : undefined;
          fn(actor, item, data, row, e);
        }
        el.addEventListener(event, fun);
      }
    });
  }

  constructor(name, module) {
    this.#id     = `${name}-${crypto.randomUUID()}`;
    this.#name   = name;
    this.#module = module ?? '';
  }
}


class ItemDataGrid_Fontawesome extends ItemDataGrid_Control {
  fastyle = '';
  faname  = '';

  onClick     = undefined;
  onMouseOver = undefined;

 
  renderTemplate() {
    const args    = this.renderTemplateArgs();
    const faStyle = this.fastyle ? `fa-${this.fastyle} ` : '';
    const faName  = this.faname  ? `fa-${this.faname}`   : 'fa-dice-d20';
    return `<i class="${faStyle}${faName} ${args.cssclass}"${args.id}${args.title}${args.name}${args.module}${args.customdata}></i>`;
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.fastyle  = options.fastyle  ?? '';
    this.faname   = options.faname   ?? '';
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    this.events.click     = 'onClick';
    this.events.mouseover = 'onMouseOver';
    if (options.onClick)     this.onClick     = options.onClick;
    if (options.onMouseOver) this.onMouseOver = options.onMouseOver;
  }
}


class ItemDataGrid_Label extends ItemDataGrid_Control {
  /** HBS expression or static text, e.g. '{{name}}' or 'Level' */
  value   = '';
  onClick = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span class="${args.cssclass}"${args.id}${args.title}${args.name}${args.module}${args.customdata}>${this.value}</span>`;
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}}}`;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    this.events.click = 'onClick';
    if (options.onClick) this.onClick = options.onClick;
  }
}


class ItemDataGrid_LabelEdit extends ItemDataGrid_Control {
  value    = '';
  filter   = null;
  onChange = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span class="pf1e-util-ig-editable ${args.cssclass}" data-id="${this.id}-display" data-value="${this.value}"${args.title}${args.name}${args.module}${args.customdata}>${this.value}</span>`
         + `<input type="text" class="pf1e-util-ig-editable-input ${args.cssclass}" data-id="${this.id}-input" value="${this.value}" data-value="${this.value}" style="display:none"${args.name}${args.module}${args.customdata}>`;
  }

  hookEvents(element, actor) {
    element.querySelectorAll(`[data-id="${this.id}-display"]`).forEach(display => {
      const input = display.nextElementSibling;
      if (!input) return;

      display.addEventListener('click', () => {
        display.style.display = 'none';
        input.style.display   = '';
        input.focus();
      });

      input.addEventListener('blur', (e) => {
        if (this.filter && !this.filter.test(input.value)) {
          input.value = display.dataset.value;
        } else {
          display.dataset.value = input.value;
          if (typeof this.onChange === 'function') {
            const ctx = resolveEventContext(e, actor);
            if (ctx) this.onChange(ctx.actor, ctx.item, ctx.data, ctx.row, e);
          }
        }
        input.style.display   = 'none';
        display.style.display = '';
      });
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}}}`;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    this.filter   = options.filter   ?? null;
    if (options.onChange) this.onChange = options.onChange;
  }
}


class ItemDataGrid_Slider extends ItemDataGrid_Control {
  value    = '';
  min      = '';
  max      = '';
  onChange = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<input type="range" class="pf1e-util-ig-slider ${args.cssclass}" data-id="${this.id}-slider" min="${this.min}" max="${this.max}" value="${this.value}" data-value="${this.value}"${args.title}${args.name}${args.module}${args.customdata}>`;
  }

  hookEvents(element, actor) {
    element.querySelectorAll(`[data-id="${this.id}-slider"]`).forEach(slider => {
      slider.addEventListener('change', (e) => {
        if (typeof this.onChange === 'function') {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onChange(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        }
      });
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}.value}}`;
    this.min      = options.min      ?? `{{${name}.min}}`;
    this.max      = options.max      ?? `{{${name}.max}}`;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    if (options.onChange) this.onChange = options.onChange;
  }
}


class ItemDataGrid_Charges extends ItemDataGrid_Control {
  value     = '';
  max       = '';
  editValue = false;
  editMax   = false;
  onChange  = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    const valPart = this.editValue
      ? `<span class="pf1e-util-ig-editable" data-id="${this.id}-value-display" data-value="${this.value}">${this.value}</span>`
      + `<input type="text" class="pf1e-util-ig-editable-input" data-id="${this.id}-value-input" value="${this.value}" data-value="${this.value}" style="display:none">`
      : `<span data-value="${this.value}">${this.value}</span>`;
    const maxPart = this.editMax
      ? `<span class="pf1e-util-ig-editable" data-id="${this.id}-max-display" data-value="${this.max}">${this.max}</span>`
      + `<input type="text" class="pf1e-util-ig-editable-input" data-id="${this.id}-max-input" value="${this.max}" data-value="${this.max}" style="display:none">`
      : `<span data-value="${this.max}">${this.max}</span>`;
    return `<span class="pf1e-util-ig-charges ${args.cssclass}"${args.id}${args.title}${args.name}${args.module}${args.customdata}>${valPart} / ${maxPart}</span>`;
  }

  #wireEditable(display, actor) {
    const input = display.nextElementSibling;
    if (!input) return;
    display.addEventListener('click', () => {
      display.style.display = 'none';
      input.style.display   = '';
      input.focus();
    });
    input.addEventListener('blur', (e) => {
      input.style.display   = 'none';
      display.style.display = '';
      if (typeof this.onChange === 'function') {
        const ctx = resolveEventContext(e, actor);
        if (ctx) this.onChange(ctx.actor, ctx.item, ctx.data, ctx.row, e);
      }
    });
  }

  hookEvents(element, actor) {
    if (this.editValue) {
      element.querySelectorAll(`[data-id="${this.id}-value-display"]`).forEach(el => this.#wireEditable(el, actor));
    }
    if (this.editMax) {
      element.querySelectorAll(`[data-id="${this.id}-max-display"]`).forEach(el => this.#wireEditable(el, actor));
    }
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value     = options.value     ?? `{{${name}.value}}`;
    this.max       = options.max       ?? `{{${name}.max}}`;
    this.editValue = options.editValue ?? false;
    this.editMax   = options.editMax   ?? false;
    this.cssclass  = options.cssclass  ?? '';
    this.title     = options.title     ?? '';
    if (options.onChange) this.onChange = options.onChange;
  }
}


class ItemDataGrid_Image extends ItemDataGrid_Control {
  value   = '';
  onClick = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<img src="${this.value}" class="${args.cssclass}"${args.id}${args.title}${args.name}${args.module}${args.customdata}>`;
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}}}`;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    this.events.click = 'onClick';
    if (options.onClick) this.onClick = options.onClick;
  }
}


/**
 * Collapse/expand control. Detects context automatically:
 *   - Inside .pf1e-util-ig-header    → toggles all .pf1e-util-ig-group in the section
 *   - Inside .pf1e-util-ig-subheader → toggles .pf1e-util-ig-body in its group
 *   - Inside .pf1e-util-ig-row (item)→ toggles .pf1e-util-ig-children in its item-wrap
 * Toggles class pf1e-util-ig-collapsed on the target; CSS handles visibility.
 */
class ItemDataGrid_Collapse extends ItemDataGrid_Control {

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span class="pf1e-util-ig-collapse ${args.cssclass}"${args.id}${args.title}${args.name}${args.module}${args.customdata}>`
         + `<i class="fa-solid fa-caret-right pf1e-util-ig-collapse-closed" style="display:none"></i>`
         + `<i class="fa-solid fa-caret-down pf1e-util-ig-collapse-open"></i>`
         + `</span>`;
  }

  hookEvents(element, _actor) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      el.addEventListener('click', () => {
        let target;
        if (el.closest('.pf1e-util-ig-header')) {
          target = el.closest('.pf1e-util-ig-section')?.querySelector('.pf1e-util-ig-header-body');
        } else if (el.closest('.pf1e-util-ig-subheader')) {
          target = el.closest('.pf1e-util-ig-subheader')?.nextElementSibling?.classList.contains('pf1e-util-ig-subheader-body')
            ? el.closest('.pf1e-util-ig-subheader').nextElementSibling
            : null;
        } else if (el.closest('.pf1e-util-ig-item')) {
          target = el.closest('.pf1e-util-ig-item')?.nextElementSibling?.classList.contains('pf1e-util-ig-item-body')
            ? el.closest('.pf1e-util-ig-item').nextElementSibling
            : null;
        }
        if (!target) return;
        const collapsed = target.classList.toggle('pf1e-util-ig-collapsed');
        el.querySelector('.pf1e-util-ig-collapse-closed').style.display = collapsed ? '' : 'none';
        el.querySelector('.pf1e-util-ig-collapse-open').style.display   = collapsed ? 'none' : '';
      });
    });
  }

  constructor(name, module) {
    super(name, module);
  }
}


/**
 * Tree line control — purely visual, no events.
 * Renders ├ for middle children, └ for the last child.
 * Use in subitem rows. Width should be set to a small fixed value (e.g. 14).
 */
class ItemDataGrid_TreeLine extends ItemDataGrid_Control {
  onClick = undefined;

  renderCell() {
    // Always include data-id so the base-class hookEvents can wire onClick / onMouseOver etc.
    // Always include the action icon span; CSS shows/hides it on subitem hover.
    return `<span class="pf1e-util-ig-tree {{#if @last}}pf1e-util-ig-tree-last{{/if}}" data-id="${this.id}">`
         + `<i class="fa-solid fa-link-slash pf1e-util-ig-tree-action"></i>`
         + `</span>`;
  }

  renderTemplate() { return ''; }

  // No hookEvents override — base class handles click/mouseover/etc. via data-id.

  constructor(name, module) {
    super(name, module);
    this.width = 14;
    this.events.click = 'onClick';
  }
}


/**
 * Zero-width invisible control that adds CSS classes to its parent row.
 * value should be a HBS expression returning space-separated class names, e.g. '{{rowClass}}'.
 * Classes are applied to the nearest .pf1e-util-ig-item or .pf1e-util-ig-subitem.
 */
class ItemDataGrid_Style extends ItemDataGrid_Control {
  value = '';

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span class="pf1e-util-ig-style-ctrl" style="display:none"${args.id} data-row-style="${this.value}"${args.customdata}></span>`;
  }

  hookEvents(element) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      const classes = el.dataset.rowStyle?.trim();
      if (!classes) return;
      const row = el.closest('.pf1e-util-ig-item, .pf1e-util-ig-subitem');
      if (row) row.classList.add(...classes.split(' ').filter(Boolean));
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value = options.value ?? `{{${name}}}`;
    this.width = 0;
  }
}


class ItemDataGrid_StyleAlternating extends ItemDataGrid_Style {
  even = '';
  odd  = '';

  hookEvents(element) {
    const groups = new Map();
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      const row = el.closest('.pf1e-util-ig-item, .pf1e-util-ig-subitem');
      if (!row) return;
      const group = row.parentElement;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(row);
    });
    groups.forEach(rows => {
      rows.forEach((row, i) => {
        if (this.even && i % 2 === 0) row.classList.add(this.even);
        if (this.odd  && i % 2 !== 0) row.classList.add(this.odd);
      });
    });
  }

  constructor(name, module, options = {}) {
    super(name, module, options);
    this.even = options.even ?? '';
    this.odd  = options.odd  ?? '';
  }
}


class ItemDataGrid_Spacer extends ItemDataGrid_Control {
  renderTemplate() { return ''; }
  hookEvents() {}
  constructor(name, module, options = {}) {
    super(name, module);
    this.width = options.width ?? 'flex';
  }
}


class ItemDataGrid_Checkbox extends ItemDataGrid_Control {
  value    = '';
  editable = false;
  onChange = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    const disabled = this.editable ? '' : ' disabled';
    return `<input type="checkbox" class="pf1e-util-ig-checkbox ${args.cssclass}" data-id="${this.id}" data-value="${this.value}" {{#if ${this.value}}}checked{{/if}}${disabled}${args.title}${args.name}${args.module}${args.customdata}>`;
  }

  hookEvents(element, actor) {
    if (!this.editable) return;
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      el.addEventListener('change', (e) => {
        if (typeof this.onChange === 'function') {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onChange(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        }
      });
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `${name}`;
    this.editable = options.editable ?? false;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    if (options.onChange) this.onChange = options.onChange;
  }
}


class ItemDataGrid_Select extends ItemDataGrid_Control {
  value    = '';
  options  = [];
  onChange = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    const opts = this.options.map(o =>
      `<option value="${o.value}" {{#if (eq ${this.value} "${o.value}")}}selected{{/if}}>${o.label}</option>`
    ).join('');
    return `<select class="pf1e-util-ig-select ${args.cssclass}" data-id="${this.id}" data-value="${this.value}"${args.title}${args.name}${args.module}${args.customdata}>${opts}</select>`;
  }

  hookEvents(element, actor) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      el.addEventListener('change', (e) => {
        if (typeof this.onChange === 'function') {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onChange(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        }
      });
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}}}`;
    this.options  = options.options  ?? [];
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
    if (options.onChange) this.onChange = options.onChange;
  }
}


class ItemDataGrid_ProgressBar extends ItemDataGrid_Control {
  value = '';
  max   = '';

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span class="pf1e-util-ig-progress ${args.cssclass}" data-id="${this.id}"${args.title}${args.name}${args.module}${args.customdata}>`
         + `<span class="pf1e-util-ig-progress-fill" style="width:calc(${this.value} / ${this.max} * 100%)"></span>`
         + `</span>`;
  }

  hookEvents() {}

  constructor(name, module, options = {}) {
    super(name, module);
    this.value    = options.value    ?? `{{${name}.value}}`;
    this.max      = options.max      ?? `{{${name}.max}}`;
    this.cssclass = options.cssclass ?? '';
    this.title    = options.title    ?? '';
  }
}

/**
 * Zero-width control that makes its parent row draggable.
 * Add to item or subitem rows. In hookEvents it locates its own hidden span,
 * walks up to the nearest [data-row-type] element, sets draggable=true,
 * and wires onDragStart / onDragEnd if provided.
 */
class ItemDataGrid_Drag extends ItemDataGrid_Control {
  onDragStart = undefined;
  onDragEnd   = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span style="display:none"${args.id}${args.customdata}></span>`;
  }

  hookEvents(element, actor) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      const row = el.closest('[data-row-type]');
      if (!row) return;
      row.draggable = true;
      if (typeof this.onDragStart === 'function') {
        row.addEventListener('dragstart', (e) => {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onDragStart(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        });
      }
      if (typeof this.onDragEnd === 'function') {
        row.addEventListener('dragend', (e) => {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onDragEnd(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        });
      }
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.width = 0;
    if (options.onDragStart) this.onDragStart = options.onDragStart;
    if (options.onDragEnd)   this.onDragEnd   = options.onDragEnd;
  }
}


/**
 * Zero-width control that makes its parent row a drop target.
 * Add to item or subitem rows. In hookEvents it locates its own hidden span,
 * walks up to the nearest [data-row-type] element, and wires
 * onDragOver / onDrop if provided.
 */
class ItemDataGrid_Drop extends ItemDataGrid_Control {
  onDragOver = undefined;
  onDrop     = undefined;

  renderTemplate() {
    const args = this.renderTemplateArgs();
    return `<span style="display:none"${args.id}${args.customdata}></span>`;
  }

  hookEvents(element, actor) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      const row = el.closest('[data-row-type]');
      if (!row) return;
      if (typeof this.onDragOver === 'function') {
        row.addEventListener('dragover', (e) => {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onDragOver(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        });
      }
      if (typeof this.onDrop === 'function') {
        row.addEventListener('drop', (e) => {
          const ctx = resolveEventContext(e, actor);
          if (ctx) this.onDrop(ctx.actor, ctx.item, ctx.data, ctx.row, e);
        });
      }
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.width = 0;
    if (options.onDragOver) this.onDragOver = options.onDragOver;
    if (options.onDrop)     this.onDrop     = options.onDrop;
  }
}


/**
 * Zero-width control that copies HBS-evaluated field values onto the parent
 * row element as data-* attributes during hookEvents. No events are exposed.
 *
 * This solves the pain point of needing arbitrary per-row data accessible via
 * row.dataset in event handlers (resolveEventContext merges row.dataset).
 *
 * Usage:
 *   new DataGrid.RowData('slotInfo', MODULE, {
 *     fields: { flagKey: '{{slotFlagKey}}', slotLevel: '{{slotLevel}}' }
 *   })
 *
 * Each field key becomes a data-* attribute on the row div. Values are
 * Handlebars expressions evaluated at render time.
 */
class ItemDataGrid_RowData extends ItemDataGrid_Control {
  #fields = {};

  renderTemplate() {
    const args  = this.renderTemplateArgs();
    const attrs = Object.entries(this.#fields)
      .map(([key, val]) => ` data-rd-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${val}"`)
      .join('');
    return `<span style="display:none"${args.id}${attrs}></span>`;
  }

  hookEvents(element) {
    element.querySelectorAll(`[data-id="${this.id}"]`).forEach(el => {
      const row = el.closest('[data-row-type]');
      if (!row) return;
      for (const key of Object.keys(this.#fields)) {
        const dsKey = 'rd' + key[0].toUpperCase() + key.slice(1);
        if (dsKey in el.dataset) row.dataset[key] = el.dataset[dsKey];
      }
    });
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.#fields = options.fields ?? {};
    this.width   = 0;
  }
}


/**
 * Renders one of N mutually-exclusive panels of controls chosen by a runtime
 * HBS variable. All panels must have the same total cell width so layout stays
 * constant regardless of which is visible.
 *
 * Keys:
 *   true / 1   → shown with {{#if value}}
 *   false / 0  → shown with {{#unless value}}
 *   any string → shown with {{#if (eq value "key")}}
 *
 * Usage:
 *   const t = new DataGrid.TogglePanel('t', MODULE, { value: 'filled' });
 *   t.addPanel(true,  [editCtrl, delCtrl, useCtrl]);
 *   t.addPanel(false, [slotAdd, slotBrowse, spacer]);
 */
class ItemDataGrid_TogglePanel extends ItemDataGrid_Control {
  value   = '';
  #panels = new Map(); // key → ItemDataGrid_Control[]

  addPanel(key, controls) {
    this.#panels.set(key, Array.isArray(controls) ? controls : [controls]);
    return this;
  }

  /** Overrides base — renders all panels' cells directly, no outer wrapper. */
  renderCell() {
    const parts = [];
    for (const [key, controls] of this.#panels) {
      const cells = controls.map(c => c.renderCell()).join('');
      let open, close;
      if (key === true || key === 1) {
        open = `{{#if ${this.value}}}`;       close = '{{/if}}';
      } else if (key === false || key === 0) {
        open = `{{#unless ${this.value}}}`;   close = '{{/unless}}';
      } else {
        open = `{{#if (eq ${this.value} "${key}")}}`;  close = '{{/if}}';
      }
      parts.push(`${open}${cells}${close}`);
    }
    return parts.join('');
  }

  renderTemplate() { return ''; }

  hookEvents(element, actor) {
    for (const controls of this.#panels.values()) {
      for (const ctrl of controls) ctrl.hookEvents(element, actor);
    }
  }

  constructor(name, module, options = {}) {
    super(name, module);
    this.value = options.value ?? '';
    this.width = 0; // width is the sum of panel controls — not a single cell
  }
}


DataGrid.Drag               = ItemDataGrid_Drag;
DataGrid.Drop               = ItemDataGrid_Drop;
DataGrid.RowData            = ItemDataGrid_RowData;
DataGrid.Control            = ItemDataGrid_Control;
DataGrid.Fontawesome        = ItemDataGrid_Fontawesome;
DataGrid.Label              = ItemDataGrid_Label;
DataGrid.LabelEdit          = ItemDataGrid_LabelEdit;
DataGrid.Slider             = ItemDataGrid_Slider;
DataGrid.Charges            = ItemDataGrid_Charges;
DataGrid.Image              = ItemDataGrid_Image;
DataGrid.Collapse           = ItemDataGrid_Collapse;
DataGrid.TreeLine           = ItemDataGrid_TreeLine;
DataGrid.Style              = ItemDataGrid_Style;
DataGrid.StyleAlternating   = ItemDataGrid_StyleAlternating;
DataGrid.Spacer             = ItemDataGrid_Spacer;
DataGrid.Checkbox           = ItemDataGrid_Checkbox;
DataGrid.Select             = ItemDataGrid_Select;
DataGrid.ProgressBar        = ItemDataGrid_ProgressBar;
DataGrid.TogglePanel        = ItemDataGrid_TogglePanel;
