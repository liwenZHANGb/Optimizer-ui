// Small DOM helpers shared by every screen. No framework: the interface is plain modules.

/** Creates an element: h('div', {class: 'x', onclick: fn, style: {...}}, child, 'text', ...). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [name, v] of Object.entries(value)) el.style.setProperty(name, v);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Colour of the i-th entity (employee, vehicle, driver, skill). */
export const color = (i) => `var(--c${((i % 8) + 8) % 8})`;

export const clone = (value) => JSON.parse(JSON.stringify(value));

/** Minutes after midnight as HH:MM. */
export function clock(minutes) {
  const m = Math.ceil(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const number = (value, digits = 0) =>
  Number(value).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const LOCK_PATH = 'M3 5V3.5a3 3 0 016 0V5h.5a1 1 0 011 1v4a1 1 0 01-1 1h-7a1 1 0 01-1-1V6a1 1 0 011-1zm1.5 0h3V3.5a1.5 1.5 0 00-3 0z';
export function lockIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', LOCK_PATH);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/**
 * Animates elements from where they were to where they are now (FLIP). Elements are matched
 * by data-key across the re-render done by `mutate`, so a task that changes lane is seen to
 * travel there. Keys listed in `moved` also get a short highlight.
 */
export function flip(root, mutate, moved = new Set(), animate = true) {
  const before = new Map();
  if (animate) {
    root.querySelectorAll('[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect()));
  }
  mutate();
  if (!animate) return;
  root.querySelectorAll('[data-key]').forEach((el) => {
    const from = before.get(el.dataset.key);
    if (!from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 5 }, { transform: 'none', zIndex: 5 }],
        { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    if (moved.has(el.dataset.key)) el.classList.add('moved');
  });
}

/** Wires HTML5 drag and drop: `source` elements carry a key, `target` elements receive it. */
export function draggable(el, key) {
  el.draggable = true;
  el.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', key);
    event.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}

export function dropTarget(el, onDrop) {
  el.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-ok');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-ok'));
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    el.classList.remove('drop-ok');
    const key = event.dataTransfer.getData('text/plain');
    if (key) onDrop(key, event);
  });
}
