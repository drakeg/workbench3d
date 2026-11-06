import { UnitSettings, formatLength, parseLength } from '../core/units';

export interface FormField {
  name: string;
  label: string;
  type: 'length' | 'number' | 'text' | 'select' | 'checkbox' | 'color';
  /** Lengths are given in inches and shown in the document's units. */
  value?: string | number | boolean;
  options?: { value: string; label: string }[];
  help?: string;
  min?: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/** A modal with a title, content and buttons. Resolves with the clicked button label, or null if dismissed. */
export function dialog(title: string, content: string | HTMLElement, buttons: string[] = ['Close'], wide = false): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'modal-backdrop' });
    const box = el('div', { className: `modal${wide ? ' wide' : ''}` });
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const body = el('div', { className: 'modal-body' });
    if (typeof content === 'string') body.innerHTML = content;
    else body.append(content);
    const footer = el('div', { className: 'modal-footer' });
    const close = (v: string | null) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    buttons.forEach((b, i) => {
      const btn = el('button', { className: i === buttons.length - 1 ? 'primary' : '', textContent: b, type: 'button' });
      btn.onclick = () => close(b);
      footer.append(btn);
    });
    const x = el('button', { className: 'modal-x', textContent: '×', title: 'Close', type: 'button' });
    x.onclick = () => close(null);
    box.append(el('div', { className: 'modal-head' }, [el('h2', { textContent: title }), x]), body, footer);
    backdrop.append(box);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close(null);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    (footer.lastElementChild as HTMLElement | null)?.focus();
  });
}

/** A form in a modal. Length fields accept any unit ("3/4", "2' 6\"", "19mm") and return inches. */
export function form(title: string, fields: FormField[], units: UnitSettings, submitLabel = 'OK'): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const f = el('form', { className: 'form' });
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const field of fields) {
      const id = `f_${field.name}_${Math.random().toString(36).slice(2, 7)}`;
      let input: HTMLInputElement | HTMLSelectElement;
      if (field.type === 'select') {
        input = el('select', { id });
        for (const o of field.options ?? []) input.append(el('option', { value: o.value, textContent: o.label }));
        if (field.value !== undefined) input.value = String(field.value);
      } else {
        input = el('input', { id });
        input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'color' ? 'color' : field.type === 'number' ? 'number' : 'text';
        if (field.type === 'checkbox') input.checked = !!field.value;
        else if (field.type === 'length' && typeof field.value === 'number') input.value = formatLength(field.value, units).replace(/^~ /, '');
        else if (field.value !== undefined) input.value = String(field.value);
        if (field.type === 'length') input.placeholder = units.system === 'metric' ? 'e.g. 19mm' : 'e.g. 1 1/2"';
      }
      inputs.set(field.name, input);
      const row = el('div', { className: `row ${field.type}` }, [el('label', { htmlFor: id, textContent: field.label }), input]);
      if (field.help) row.append(el('small', { textContent: field.help }));
      f.append(row);
    }
    const err = el('div', { className: 'form-error' });
    f.append(err);
    const submit = () => {
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        const input = inputs.get(field.name)!;
        if (field.type === 'checkbox') out[field.name] = (input as HTMLInputElement).checked;
        else if (field.type === 'length') {
          const v = parseLength(input.value, units);
          if (v === null || (field.min !== undefined && v < field.min)) {
            err.textContent = `${field.label}: enter a length like 3/4, 1 1/2", 2' 6" or 19mm`;
            input.focus();
            return false;
          }
          out[field.name] = v;
        } else if (field.type === 'number') {
          const v = parseFloat(input.value);
          if (isNaN(v)) {
            err.textContent = `${field.label}: enter a number`;
            return false;
          }
          out[field.name] = v;
        } else out[field.name] = input.value;
      }
      result = out;
      return true;
    };
    let result: Record<string, unknown> | null = null;
    const p = dialog(title, f, ['Cancel', submitLabel]);
    f.addEventListener('submit', (e) => e.preventDefault());
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') {
        e.preventDefault();
        if (submit()) (document.querySelector('.modal-footer button.primary') as HTMLButtonElement | null)?.click();
      }
    });
    // intercept the primary button so validation runs first
    queueMicrotask(() => {
      const primary = document.querySelector('.modal-footer button.primary') as HTMLButtonElement | null;
      if (primary) {
        const orig = primary.onclick;
        primary.onclick = (ev) => {
          if (result || submit()) orig?.call(primary, ev);
        };
      }
      (f.querySelector('input, select') as HTMLElement | null)?.focus();
    });
    p.then((b) => resolve(b === submitLabel ? result : null));
  });
}
