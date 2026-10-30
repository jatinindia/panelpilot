/** Typed `getElementById` that fails loudly when the markup and code disagree. */
export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) {
    throw new Error(`Expected #${id} to be ${type.name}, found ${node ? node.constructor.name : 'nothing'}`);
  }
  return node;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, children: readonly (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

export type ToastKind = 'info' | 'error';

export function toast(message: string, kind: ToastKind): void {
  const stack = byId('toasts', HTMLDivElement);
  const node = el('div', kind === 'error' ? 'toast error' : 'toast', [message]);
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  stack.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a keyboard event is aimed at a text field (shortcuts should not fire). */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An icon from the sprite in index.html. */
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export function iconOnlyButton(label: string, iconName: string, className: string): HTMLButtonElement {
  const button = el('button', className ? `icon-btn ${className}` : 'icon-btn', [icon(iconName)]);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}
