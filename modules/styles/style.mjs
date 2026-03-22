/**
 * CSS Style System
 * A programmatic, accessor-based CSS property tree.
 *
 * Invariant: kebab-case-property === accessor.path.joined('-')
 *
 * Usage:
 *   const t = new CSSStyle();
 *   t.border.width = '1px';
 *   t.background.color.value = '#1a1a2e';
 *   t.selectors.add('.my-class');
 *   console.log(t.CSS);
 *   t.fromCSS('background-color: red; border-width: 1px;');
 */

// ---------------------------------------------------------------------------
// CSSProperties — root store, single source of truth
// ---------------------------------------------------------------------------

class CSSProperties {
  #properties = new Map();

  _set(path, value) {
    this.#properties.set(path, value);
  }

  _get(path) {
    return this.#properties.get(path);
  }

  _delete(path) {
    this.#properties.delete(path);
  }

  _has(path) {
    return this.#properties.has(path);
  }

  _entries() {
    return [...this.#properties.entries()];
  }

  _clear() {
    this.#properties.clear();
  }

  /**
   * Render all properties to a CSS declaration block string.
   * Dot-paths are kebab-joined, leaf 'value' segments are stripped.
   * e.g. background.color.value → background-color
   *      border.top.width       → border-top-width
   */
  toString() {
    return [...this.#properties.entries()]
      .map(([path, val]) => {
        const prop = path
          .split('.')
          .filter(p => p !== 'value')
          .join('-');
        return `${prop}: ${val};`;
      })
      .join(' ');
  }
}

// ---------------------------------------------------------------------------
// CSSAccessor — base for all category/sub-category nodes
// ---------------------------------------------------------------------------

class CSSAccessor {
  #parent;
  #name;

  constructor(parent, name) {
    this.#parent = parent;
    this.#name   = name;
  }

  get _name() { return this.#name; }

  /**
   * Build the full dot path by walking up the parent chain.
   * Stops when it hits a CSSProperties (the root).
   */
  _path(prop) {
    const segments = [this.#name, prop].filter(Boolean);
    let cursor = this.#parent;
    while (cursor instanceof CSSAccessor) {
      segments.unshift(cursor._name);
      cursor = cursor._parent;
    }
    return segments.join('.');
  }

  get _parent() { return this.#parent; }

  _root() {
    let cursor = this.#parent;
    while (cursor instanceof CSSAccessor) cursor = cursor._parent;
    return cursor; // CSSProperties instance
  }

  _set(prop, value) {
    this._root()._set(this._path(prop), value);
  }

  _get(prop) {
    return this._root()._get(this._path(prop));
  }

  _delete(prop) {
    this._root()._delete(this._path(prop));
  }

  toString() {
    const prefix = this._path('').slice(0, -1); // strip trailing dot
    return this._root()._entries()
      .filter(([k]) => k === prefix || k.startsWith(prefix + '.'))
      .map(([k, v]) => {
        const prop = k.split('.').filter(p => p !== 'value').join('-');
        return `${prop}: ${v};`;
      })
      .join(' ');
  }
}

// ---------------------------------------------------------------------------
// Leaf accessors — single-value terminals
// ---------------------------------------------------------------------------

class CSSLeaf extends CSSAccessor {
  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// Color leaf (reusable wherever 'color' appears)
// ---------------------------------------------------------------------------

class CSSColorLeaf extends CSSLeaf {
  constructor(parent) { super(parent, 'color'); }
}

// ---------------------------------------------------------------------------
// CSSBackground
// ---------------------------------------------------------------------------

class CSSBackground extends CSSAccessor {
  constructor(parent) {
    super(parent, 'background');
    this.color      = new CSSColorLeaf(this);
    this.image      = new CSSLeaf(this, 'image');
    this.size       = new CSSLeaf(this, 'size');
    this.position   = new CSSLeaf(this, 'position');
    this.repeat     = new CSSLeaf(this, 'repeat');
    this.attachment = new CSSLeaf(this, 'attachment');
    this.origin     = new CSSLeaf(this, 'origin');
    this.clip       = new CSSLeaf(this, 'clip');
    this.blend      = new CSSLeaf(this, 'blend-mode');
  }

  // shorthand
  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSBorderSide — top/right/bottom/left
// ---------------------------------------------------------------------------

class CSSBorderSide extends CSSAccessor {
  constructor(parent, side) {
    super(parent, side);
    this.color  = new CSSColorLeaf(this);
    this.style  = new CSSLeaf(this, 'style');
    this.width  = new CSSLeaf(this, 'width');
    this.radius = new CSSLeaf(this, 'radius');
  }
}

// ---------------------------------------------------------------------------
// CSSBorderImage
// ---------------------------------------------------------------------------

class CSSBorderImage extends CSSAccessor {
  constructor(parent) {
    super(parent, 'image');
    this.source  = new CSSLeaf(this, 'source');
    this.slice   = new CSSLeaf(this, 'slice');
    this.width   = new CSSLeaf(this, 'width');
    this.outset  = new CSSLeaf(this, 'outset');
    this.repeat  = new CSSLeaf(this, 'repeat');
  }
}

// ---------------------------------------------------------------------------
// CSSBorder
// ---------------------------------------------------------------------------

class CSSBorder extends CSSAccessor {
  constructor(parent) {
    super(parent, 'border');
    this.color    = new CSSColorLeaf(this);
    this.style    = new CSSLeaf(this, 'style');
    this.width    = new CSSLeaf(this, 'width');
    this.radius   = new CSSLeaf(this, 'radius');
    this.top      = new CSSBorderSide(this, 'top');
    this.right    = new CSSBorderSide(this, 'right');
    this.bottom   = new CSSBorderSide(this, 'bottom');
    this.left     = new CSSBorderSide(this, 'left');
    this.image    = new CSSBorderImage(this);
    this.collapse = new CSSLeaf(this, 'collapse');
    this.spacing  = new CSSLeaf(this, 'spacing');
  }

  // shorthand
  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSFont
// ---------------------------------------------------------------------------

class CSSFont extends CSSAccessor {
  constructor(parent) {
    super(parent, 'font');
    this.family  = new CSSLeaf(this, 'family');
    this.size    = new CSSLeaf(this, 'size');
    this.weight  = new CSSLeaf(this, 'weight');
    this.style   = new CSSLeaf(this, 'style');
    this.variant = new CSSLeaf(this, 'variant');
    this.stretch = new CSSLeaf(this, 'stretch');
  }

  // semantic shortcuts
  get bold()   { return this._get('weight') === 'bold'; }
  set bold(v)  { this._set('weight', v ? 'bold' : 'normal'); }
  get italic() { return this._get('style') === 'italic'; }
  set italic(v){ this._set('style', v ? 'italic' : 'normal'); }

  // shorthand
  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSText
// ---------------------------------------------------------------------------

class CSSText extends CSSAccessor {
  constructor(parent) {
    super(parent, 'text');
    this.align      = new CSSLeaf(this, 'align');
    this.decoration = new CSSLeaf(this, 'decoration');
    this.transform  = new CSSLeaf(this, 'transform');
    this.overflow   = new CSSLeaf(this, 'overflow');
    this.shadow     = new CSSLeaf(this, 'shadow');
    this.indent     = new CSSLeaf(this, 'indent');
    this.wrap       = new CSSLeaf(this, 'wrap');
  }
}

// ---------------------------------------------------------------------------
// CSSMargin / CSSPadding
// ---------------------------------------------------------------------------

class CSSSpacingAccessor extends CSSAccessor {
  constructor(parent, name) {
    super(parent, name);
    this.top    = new CSSLeaf(this, 'top');
    this.right  = new CSSLeaf(this, 'right');
    this.bottom = new CSSLeaf(this, 'bottom');
    this.left   = new CSSLeaf(this, 'left');
  }

  // shorthand
  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

class CSSMargin  extends CSSSpacingAccessor { constructor(p) { super(p, 'margin');  } }
class CSSPadding extends CSSSpacingAccessor { constructor(p) { super(p, 'padding'); } }

// ---------------------------------------------------------------------------
// CSSGap
// ---------------------------------------------------------------------------

class CSSGap extends CSSAccessor {
  constructor(parent) {
    super(parent, 'gap');
    this.row    = new CSSLeaf(this, 'row');
    this.column = new CSSLeaf(this, 'column');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSFlex
// ---------------------------------------------------------------------------

class CSSFlexAlign extends CSSAccessor {
  constructor(parent) {
    super(parent, 'align');
    this.items   = new CSSLeaf(this, 'items');
    this.content = new CSSLeaf(this, 'content');
    this.self    = new CSSLeaf(this, 'self');
  }
}

class CSSFlex extends CSSAccessor {
  constructor(parent) {
    super(parent, 'flex');
    this.direction = new CSSLeaf(this, 'direction');
    this.wrap      = new CSSLeaf(this, 'wrap');
    this.grow      = new CSSLeaf(this, 'grow');
    this.shrink    = new CSSLeaf(this, 'shrink');
    this.basis     = new CSSLeaf(this, 'basis');
    this.align     = new CSSFlexAlign(this);
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSGrid
// ---------------------------------------------------------------------------

class CSSGridTemplate extends CSSAccessor {
  constructor(parent) {
    super(parent, 'template');
    this.columns = new CSSLeaf(this, 'columns');
    this.rows    = new CSSLeaf(this, 'rows');
    this.areas   = new CSSLeaf(this, 'areas');
  }
}

class CSSGridSpan extends CSSAccessor {
  constructor(parent, name) {
    super(parent, name);
    this.start = new CSSLeaf(this, 'start');
    this.end   = new CSSLeaf(this, 'end');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

class CSSGridAuto extends CSSAccessor {
  constructor(parent) {
    super(parent, 'auto');
    this.columns = new CSSLeaf(this, 'columns');
    this.rows    = new CSSLeaf(this, 'rows');
    this.flow    = new CSSLeaf(this, 'flow');
  }
}

class CSSGrid extends CSSAccessor {
  constructor(parent) {
    super(parent, 'grid');
    this.template = new CSSGridTemplate(this);
    this.column   = new CSSGridSpan(this, 'column');
    this.row      = new CSSGridSpan(this, 'row');
    this.auto     = new CSSGridAuto(this);
    this.area     = new CSSLeaf(this, 'area');
  }
}

// ---------------------------------------------------------------------------
// CSSOutline
// ---------------------------------------------------------------------------

class CSSOutline extends CSSAccessor {
  constructor(parent) {
    super(parent, 'outline');
    this.color  = new CSSColorLeaf(this);
    this.style  = new CSSLeaf(this, 'style');
    this.width  = new CSSLeaf(this, 'width');
    this.offset = new CSSLeaf(this, 'offset');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSOverflow
// ---------------------------------------------------------------------------

class CSSOverflow extends CSSAccessor {
  constructor(parent) {
    super(parent, 'overflow');
    this.x = new CSSLeaf(this, 'x');
    this.y = new CSSLeaf(this, 'y');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSTransform
// ---------------------------------------------------------------------------

class CSSTransform extends CSSAccessor {
  constructor(parent) {
    super(parent, 'transform');
    this.origin      = new CSSLeaf(this, 'origin');
    this.style       = new CSSLeaf(this, 'style');
    this.perspective = new CSSLeaf(this, 'perspective');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSTransition
// ---------------------------------------------------------------------------

class CSSTransition extends CSSAccessor {
  constructor(parent) {
    super(parent, 'transition');
    this.property = new CSSLeaf(this, 'property');
    this.duration = new CSSLeaf(this, 'duration');
    this.timing   = new CSSLeaf(this, 'timing-function');
    this.delay    = new CSSLeaf(this, 'delay');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSAnimation
// ---------------------------------------------------------------------------

class CSSAnimation extends CSSAccessor {
  constructor(parent) {
    super(parent, 'animation');
    this.name      = new CSSLeaf(this, 'name');
    this.duration  = new CSSLeaf(this, 'duration');
    this.timing    = new CSSLeaf(this, 'timing-function');
    this.delay     = new CSSLeaf(this, 'delay');
    this.iteration = new CSSLeaf(this, 'iteration-count');
    this.direction = new CSSLeaf(this, 'direction');
    this.fill      = new CSSLeaf(this, 'fill-mode');
    this.play      = new CSSLeaf(this, 'play-state');
  }

  get value()  { return this._get('value'); }
  set value(v) { this._set('value', v); }
}

// ---------------------------------------------------------------------------
// CSSList
// ---------------------------------------------------------------------------

class CSSList extends CSSAccessor {
  constructor(parent) {
    super(parent, 'list');
    this.style    = new CSSLeaf(this, 'style');
    this.type     = new CSSLeaf(this, 'style-type');
    this.position = new CSSLeaf(this, 'style-position');
    this.image    = new CSSLeaf(this, 'style-image');
  }
}

// ---------------------------------------------------------------------------
// CSSPointer
// ---------------------------------------------------------------------------

class CSSPointer extends CSSAccessor {
  constructor(parent) {
    super(parent, 'pointer');
    this.events = new CSSLeaf(this, 'events');
  }
}

// ---------------------------------------------------------------------------
// CSSSelectorList
// ---------------------------------------------------------------------------

class CSSSelectorList {
  #selectors = [];

  add(selector) {
    if (!this.#selectors.includes(selector)) this.#selectors.push(selector);
    return this;
  }

  remove(selector) {
    this.#selectors = this.#selectors.filter(s => s !== selector);
    return this;
  }

  get(index) { return this.#selectors[index]; }

  get length() { return this.#selectors.length; }

  toString() { return this.#selectors.join(', '); }

  [Symbol.iterator]() { return this.#selectors[Symbol.iterator](); }
}

// ---------------------------------------------------------------------------
// CSSStyle — the top-level object
// ---------------------------------------------------------------------------

class CSSStyle extends CSSProperties {
  constructor() {
    super();

    // accessors
    this.background = new CSSBackground(this);
    this.border     = new CSSBorder(this);
    this.font       = new CSSFont(this);
    this.text       = new CSSText(this);
    this.margin     = new CSSMargin(this);
    this.padding    = new CSSPadding(this);
    this.gap        = new CSSGap(this);
    this.flex       = new CSSFlex(this);
    this.grid       = new CSSGrid(this);
    this.outline    = new CSSOutline(this);
    this.overflow   = new CSSOverflow(this);
    this.transform  = new CSSTransform(this);
    this.transition = new CSSTransition(this);
    this.animation  = new CSSAnimation(this);
    this.list       = new CSSList(this);
    this.pointer    = new CSSPointer(this);

    // flat properties with no sub-structure
    this._flatProps = new Set([
      'color', 'cursor', 'display', 'position', 'top', 'right', 'bottom', 'left',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'z-index', 'visibility', 'opacity', 'float', 'clear', 'resize', 'content',
      'filter', 'clip-path', 'appearance', 'box-sizing', 'white-space',
      'line-height', 'letter-spacing', 'word-spacing', 'vertical-align',
      'table-layout', 'caption-side', 'empty-cells', 'order', 'justify-content',
      'justify-self', 'justify-items', 'object-fit', 'object-position',
      'will-change', 'user-select', 'box-shadow',
    ]);

    // selector list
    this.selectors = new CSSSelectorList();
  }

  // -------------------------------------------------------------------------
  // apply — dot-path setter with kebab fallback for unknowns
  // -------------------------------------------------------------------------

  apply(path, value) {
    const parts = path.split('.');
    let target  = this;

    for (const part of parts.slice(0, -1)) {
      if (target[part] === undefined || target[part] === null) {
        // unknown path — store as kebab-cased raw property
        this._set(parts.join('-'), value);
        return this;
      }
      target = target[part];
    }

    const leaf = parts.at(-1);

    if (target instanceof CSSProperties || target instanceof CSSAccessor) {
      // if the target has a setter for the leaf, use it
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), leaf);
      if (descriptor && descriptor.set) {
        target[leaf] = value;
      } else if (target[leaf] instanceof CSSLeaf || target[leaf] instanceof CSSAccessor) {
        // leaf node — set its value
        target[leaf].value = value;
      } else {
        // unknown at this level — kebab and store raw
        this._set(parts.join('-'), value);
      }
    } else {
      this._set(parts.join('-'), value);
    }

    return this;
  }

  // -------------------------------------------------------------------------
  // fromCSS — parse a CSS declaration block string and hydrate
  // -------------------------------------------------------------------------

  fromCSS(cssString) {
    // strip selector + braces if a full rule was passed
    const block = cssString.includes('{')
      ? cssString.replace(/^[^{]*\{/, '').replace(/\}[^}]*$/, '')
      : cssString;

    const declarations = block
      .split(';')
      .map(d => d.trim())
      .filter(Boolean);

    for (const declaration of declarations) {
      const colonIdx = declaration.indexOf(':');
      if (colonIdx === -1) continue;

      const prop  = declaration.slice(0, colonIdx).trim();
      const value = declaration.slice(colonIdx + 1).trim();

      // kebab → dot path
      const path = prop.split('-').join('.');
      this.apply(path, value);
    }

    return this;
  }

  // -------------------------------------------------------------------------
  // CSS — render to a full rule string
  // -------------------------------------------------------------------------

  get CSS() {
    const declarations = this.toString();
    if (!declarations) return '';
    const selectorText = this.selectors.toString() || '&';
    return `${selectorText} { ${declarations} }`;
  }

  // -------------------------------------------------------------------------
  // fromElement — hydrate from a live element's computed styles
  // -------------------------------------------------------------------------

  fromElement(element) {
    const computed = window.getComputedStyle(element);
    for (const prop of computed) {
      const value = computed.getPropertyValue(prop).trim();
      if (value) this.apply(prop.split('-').join('.'), value);
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // clone — deep copy of current state into a new CSSStyle
  // -------------------------------------------------------------------------

  clone() {
    const next = new CSSStyle();
    next.fromCSS(this.toString());
    for (const selector of this.selectors) next.selectors.add(selector);
    return next;
  }

  // -------------------------------------------------------------------------
  // clear — reset everything
  // -------------------------------------------------------------------------

  clear() {
    this._clear();
    this.selectors = new CSSSelectorList();
    return this;
  }
}

// ---------------------------------------------------------------------------
// Style — flyweight registry, one CSSStyleSheet per usage key
// ---------------------------------------------------------------------------

class Style {
  static #registry = new Map();

  #key;
  #sheet;
  #rules = new Map(); // selector string → CSSStyle

  constructor(key) {
    if (Style.#registry.has(key)) return Style.#registry.get(key);

    this.#key   = key;
    this.#sheet = new CSSStyleSheet();
    Style.#registry.set(key, this);

    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.#sheet];
  }

  get key()   { return this.#key; }
  get sheet() { return this.#sheet; }

  /**
   * Get or create a CSSStyle for a given selector.
   */
  rule(selector) {
    if (!this.#rules.has(selector)) {
      const style = new CSSStyle();
      style.selectors.add(selector);
      this.#rules.set(selector, style);
    }
    return this.#rules.get(selector);
  }

  /**
   * Push all rules into the adopted stylesheet.
   */
  commit() {
    const css = [...this.#rules.values()]
      .map(r => r.CSS)
      .filter(Boolean)
      .join('\n');
    this.#sheet.replaceSync(css);
    return this;
  }

  /**
   * Hydrate from an existing CSSStyleSheet.
   */
  fromSheet(sheet) {
    for (const rule of sheet.cssRules) {
      if (rule.selectorText) {
        this.rule(rule.selectorText).fromCSS(rule.style.cssText);
      }
    }
    return this;
  }

  /**
   * Remove this style's sheet from the document and deregister.
   */
  destroy() {
    document.adoptedStyleSheets = document.adoptedStyleSheets
      .filter(s => s !== this.#sheet);
    Style.#registry.delete(this.#key);
  }

  static get(key)     { return Style.#registry.get(key); }
  static has(key)     { return Style.#registry.has(key); }
  static release(key) { Style.#registry.get(key)?.destroy(); }
  static keys()       { return [...Style.#registry.keys()]; }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  CSSProperties,
  CSSAccessor,
  CSSLeaf,
  CSSColorLeaf,
  CSSBackground,
  CSSBorder,
  CSSBorderSide,
  CSSFont,
  CSSText,
  CSSMargin,
  CSSPadding,
  CSSGap,
  CSSFlex,
  CSSGrid,
  CSSOutline,
  CSSOverflow,
  CSSTransform,
  CSSTransition,
  CSSAnimation,
  CSSList,
  CSSPointer,
  CSSSelectorList,
  CSSStyle,
  Style,
};