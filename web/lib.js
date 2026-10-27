// Shared UI toolkit: API client, formatting, and small components (no build step; htm + preact).
import { h, render, createContext } from '/vendor/preact.mjs';
import { useState, useEffect, useCallback, useContext, useRef } from '/vendor/hooks.mjs';
import htm from '/vendor/htm.mjs';

export const html = htm.bind(h);
export { h, render, useState, useEffect, useCallback, useContext, useRef };

// ---- app state -------------------------------------------------------------------------
export const App = createContext({ meta: null, user: null, can: () => false });
export const useApp = () => useContext(App);

// ---- API -----------------------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status === 401 && !path.endsWith('/auth/login')) onUnauthorized();
  if (!res.ok) throw new ApiError(data?.error ?? `Hata ${res.status}`, res.status, data?.details);
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);

export function useApi(path, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    set((s) => ({ ...s, loading: true, error: null }));
    get(path)
      .then((data) => alive && set({ data, error: null, loading: false }))
      .catch((error) => alive && set({ data: null, error, loading: false }));
    return () => (alive = false);
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function qs(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- toast -----------------------------------------------------------------------------
const listeners = new Set();
export function toast(message, kind = 'ok') {
  const t = { id: Math.random(), message, kind };
  listeners.forEach((l) => l(t));
}
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const l = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.kind === 'error' ? 7000 : 3500);
    };
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div class=${`toast ${t.kind}`} key=${t.id}>${t.message}</div>`)}</div>`;
}
export function showError(e) {
  const details = Array.isArray(e?.details) ? ' — ' + e.details.join(' · ') : '';
  toast((e?.message ?? String(e)) + details, 'error');
}
/** Runs an async action, toasting success/failure. Returns the result or undefined. */
export async function act(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return r;
  } catch (e) {
    showError(e);
  }
}

// ---- formatting ------------------------------------------------------------------------
let currencies = {};
export const setCurrencies = (list) => (currencies = Object.fromEntries(list.map((c) => [c.code, c])));
export const decimalsOf = (code) => currencies[code]?.decimals ?? 2;
const nf = (d) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Minor units (number | numeric string | bigint) → "1.234,56 TRY". Exact: never goes through float. */
export function money(minor, code, { plain = false } = {}) {
  if (minor === null || minor === undefined || minor === '') return '—';
  const d = decimalsOf(code);
  let v;
  try {
    v = BigInt(String(minor));
  } catch {
    return String(minor);
  }
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(d);
  const int = abs / scale;
  const frac = (abs % scale).toString().padStart(d, '0');
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = (neg ? '-' : '') + intStr + (d ? ',' + frac : '');
  return plain || !code ? s : `${s} ${code}`;
}
/** Decimal string ("1234.5678") → formatted money, rounded half-up to the currency's digits without floats. */
export function decMoney(s, code) {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(s ?? ''));
  if (!m) return s ?? '—';
  const d = decimalsOf(code);
  const frac = (m[3] ?? '').padEnd(d + 1, '0');
  let v = BigInt(m[2] + frac.slice(0, d));
  if (Number(frac[d]) >= 5) v += 1n;
  return money(m[1] ? -v : v, code);
}
/** Minor units → plain decimal string for inputs ("1234.56"). */
export function minorToInput(minor, code) {
  if (minor === null || minor === undefined) return '';
  const d = decimalsOf(code);
  const v = BigInt(String(minor));
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(d);
  return (neg ? '-' : '') + (abs / scale).toString() + (d ? '.' + (abs % scale).toString().padStart(d, '0') : '');
}
export const num = (v, d = 0) => (v === null || v === undefined || v === '' ? '—' : nf(d).format(Number(v)));
export const dateTr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('.') : '—');
export const dateTimeTr = (v) => (v ? `${dateTr(v)} ${String(v).slice(11, 16)}` : '—');
export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = (d = today()) => d.slice(0, 7) + '-01';

const STATUS = {
  active: ['Aktif', 'ok'],
  passive: ['Pasif', 'muted'],
  unmapped: ['Eşleşmemiş', 'warn'],
  draft: ['Taslak', 'muted'],
  pending_approval: ['Onay bekliyor', 'warn'],
  retired: ['Emekli', 'muted'],
  rejected: ['Reddedildi', 'bad'],
  calculated: ['Hesaplandı', 'warn'],
  approved: ['Onaylandı', 'info'],
  paid: ['Ödendi', 'ok'],
  cancelled: ['İptal', 'muted'],
  unpaid: ['Ödenmedi', 'warn'],
  open: ['Açık', 'warn'],
  closed: ['Kapalı', 'muted'],
  resolved: ['Çözüldü', 'ok'],
  acknowledged: ['Görüldü', 'info'],
  pending: ['Bekliyor', 'warn'],
  connected: ['Bağlı', 'ok'],
  not_connected: ['Bağlı değil', 'muted'],
  error: ['Hata', 'bad'],
  disabled: ['Kapalı', 'muted'],
  estimated: ['Tahmini', 'warn'],
  invoiced: ['Faturalı', 'ok'],
  missing_data: ['Veri yok', 'bad'],
  matched: ['Eşleşti', 'ok'],
  difference: ['Fark var', 'bad'],
  critical: ['Kritik', 'bad'],
  warning: ['Uyarı', 'warn'],
  info: ['Bilgi', 'info'],
  ended: ['Bitti', 'muted'],
};
export const Badge = ({ s, label }) => {
  const [t, k] = STATUS[s] ?? [label ?? s, 'muted'];
  return html`<span class=${`badge ${k}`}>${label ?? t}</span>`;
};

// ---- components ------------------------------------------------------------------------
export const Button = ({ kind = 'secondary', children, ...p }) => html`<button type="button" class=${`btn ${kind}`} ...${p}>${children}</button>`;

export function Card({ title, actions, children, class: cls = '' }) {
  return html`<section class=${`card ${cls}`}>
    ${(title || actions) && html`<header class="card-h"><h2>${title}</h2><div class="row gap">${actions}</div></header>`}
    ${children}
  </section>`;
}

export function Page({ title, subtitle, actions, children }) {
  return html`<div class="page">
    <header class="page-h">
      <div><h1>${title}</h1>${subtitle && html`<p class="muted">${subtitle}</p>`}</div>
      <div class="row gap wrap">${actions}</div>
    </header>
    ${children}
  </div>`;
}

export function Loading({ state, children }) {
  if (state.error) return html`<div class="empty bad">${state.error.message}</div>`;
  if (state.loading && !state.data) return html`<div class="empty">Yükleniyor…</div>`;
  return children(state.data);
}

/**
 * columns: [{ key, label, render?(row), align?: 'right', money?: currencyKey|code }]
 */
export function Table({ columns, rows, onRow, empty = 'Kayıt yok', dense }) {
  if (!rows?.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="table-wrap"><table class=${dense ? 'dense' : ''}>
    <thead><tr>${columns.map((c) => html`<th class=${c.align === 'right' || c.money ? 'r' : ''}>${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map(
      (r, i) => html`<tr key=${r.id ?? i} class=${onRow ? 'click' : ''} onClick=${onRow ? () => onRow(r) : undefined}>
        ${columns.map((c) => {
          let v = c.render ? c.render(r) : r[c.key];
          if (c.money) v = money(r[c.key], r[c.money] ?? c.money);
          return html`<td class=${c.align === 'right' || c.money ? 'r num' : ''}>${v ?? '—'}</td>`;
        })}
      </tr>`,
    )}</tbody>
  </table></div>`;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
      <header class="card-h"><h2>${title}</h2><button class="btn ghost" onClick=${onClose} aria-label="Kapat">✕</button></header>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">${tabs.map(
    ([k, label]) => html`<button role="tab" aria-selected=${value === k} class=${value === k ? 'on' : ''} onClick=${() => onChange(k)}>${label}</button>`,
  )}</div>`;
}

export function DateRange({ value, onChange }) {
  const t = today();
  const presets = [
    ['Bugün', t, t],
    ['7 gün', new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10), t],
    ['Bu ay', monthStart(t), t],
    ['Geçen ay', monthStart(new Date(Date.parse(monthStart(t)) - 864e5).toISOString().slice(0, 10)), new Date(Date.parse(monthStart(t)) - 864e5).toISOString().slice(0, 10)],
    ['Bu yıl', t.slice(0, 4) + '-01-01', t],
  ];
  return html`<div class="row gap wrap daterange">
    ${presets.map(([l, f, to]) => html`<button class=${`chip ${value.from === f && value.to === to ? 'on' : ''}`} onClick=${() => onChange({ from: f, to })}>${l}</button>`)}
    <input type="date" value=${value.from} aria-label="Başlangıç" onChange=${(e) => onChange({ ...value, from: e.target.value })} />
    <span class="muted">–</span>
    <input type="date" value=${value.to} aria-label="Bitiş" onChange=${(e) => onChange({ ...value, to: e.target.value })} />
  </div>`;
}

/**
 * Declarative form. fields: [{ name, label, type: text|number|decimal|date|select|textarea|checkbox|money|json, options, required, hint, show?(values) }]
 */
export function Form({ fields, initial = {}, onSubmit, submitLabel = 'Kaydet', onCancel, children }) {
  const [v, setV] = useState(() => ({ ...Object.fromEntries(fields.map((f) => [f.name, f.def ?? (f.type === 'checkbox' ? false : '')])), ...initial }));
  const [busy, setBusy] = useState(false);
  const set = (k, x) => setV((s) => ({ ...s, [k]: x }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(v, setV);
    } finally {
      setBusy(false);
    }
  };
  return html`<form class="form" onSubmit=${submit}>
    <div class="grid2">${fields.filter((f) => !f.show || f.show(v)).map((f) => html`<${Field} f=${f} value=${v[f.name]} set=${(x) => set(f.name, x)} />`)}</div>
    ${typeof children === 'function' ? children(v, set) : children}
    <div class="row gap end">
      ${onCancel && html`<${Button} onClick=${onCancel}>Vazgeç</${Button}>`}
      <button class="btn primary" type="submit" disabled=${busy}>${busy ? 'Kaydediliyor…' : submitLabel}</button>
    </div>
  </form>`;
}

export function Field({ f, value, set }) {
  const id = `f_${f.name}`;
  const common = { id, required: f.required, value: value ?? '', onInput: (e) => set(e.target.value), placeholder: f.placeholder };
  let input;
  switch (f.type) {
    case 'select':
      input = html`<select ...${common} onChange=${(e) => set(e.target.value)}>
        ${!f.required && html`<option value="">—</option>`}
        ${(f.options ?? []).map((o) => (Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o}>${o}</option>`))}
      </select>`;
      break;
    case 'textarea':
      input = html`<textarea ...${common} rows=${f.rows ?? 3}></textarea>`;
      break;
    case 'checkbox':
      input = html`<input id=${id} type="checkbox" checked=${!!value} onChange=${(e) => set(e.target.checked)} />`;
      break;
    case 'date':
      input = html`<input type="date" ...${common} />`;
      break;
    case 'number':
      input = html`<input type="number" step="1" ...${common} />`;
      break;
    case 'decimal':
    case 'money':
      input = html`<input inputmode="decimal" pattern="-?[0-9]+([.,][0-9]+)?" ...${common} onInput=${(e) => set(e.target.value.replace(',', '.'))} />`;
      break;
    case 'password':
      input = html`<input type="password" autocomplete="new-password" ...${common} />`;
      break;
    default:
      input = html`<input type="text" ...${common} />`;
  }
  return html`<label class=${`field ${f.type === 'checkbox' ? 'inline' : ''} ${f.wide ? 'wide' : ''}`} for=${id}>
    <span>${f.label}${f.required ? ' *' : ''}</span>${input}${f.hint && html`<small class="muted">${f.hint}</small>`}
  </label>`;
}

/** Asks for a reason (required for critical actions) and resolves with it, or null on cancel. */
export function usePrompt() {
  const [p, setP] = useState(null);
  const ask = (title, opts = {}) =>
    new Promise((resolve) =>
      setP({ title, ...opts, resolve: (v) => (setP(null), resolve(v)) }),
    );
  const node =
    p &&
    html`<${Modal} title=${p.title} onClose=${() => p.resolve(null)}>
      ${p.text && html`<p>${p.text}</p>`}
      <${Form}
        fields=${p.fields ?? [{ name: 'reason', label: p.label ?? 'Gerekçe', type: 'textarea', required: p.required !== false, wide: true }]}
        submitLabel=${p.ok ?? 'Onayla'}
        onCancel=${() => p.resolve(null)}
        onSubmit=${(v) => p.resolve(v)}
      />
    </${Modal}>`;
  return [ask, node];
}

export function Kpi({ label, value, sub, tone, onClick, note }) {
  return html`<button class=${`kpi ${tone ?? ''}`} onClick=${onClick} disabled=${!onClick}>
    <span class="kpi-l">${label}</span>
    <strong class="kpi-v num">${value}</strong>
    ${sub && html`<span class="kpi-s">${sub}</span>`}
    ${note && html`<span class="kpi-n">${note}</span>`}
  </button>`;
}

/** Tiny dependency-free bar/line chart for daily series. */
export function MiniChart({ series, keys }) {
  if (!series?.length) return html`<div class="empty">Veri yok</div>`;
  const W = 640;
  const H = 160;
  const vals = series.flatMap((s) => keys.map((k) => Number(s[k.key])));
  const max = Math.max(1, ...vals.map(Math.abs));
  const step = W / series.length;
  const bw = Math.max(1, step / (keys.length + 1));
  return html`<figure class="chart">
    <svg viewBox=${`0 0 ${W} ${H + 18}`} role="img" aria-label="Günlük seri">
      <line x1="0" x2=${W} y1=${H} y2=${H} class="axis" />
      ${series.map((s, i) =>
        keys.map((k, j) => {
          const v = Number(s[k.key]);
          const hgt = (Math.abs(v) / max) * (H - 6);
          return html`<rect x=${i * step + j * bw + bw / 2} y=${H - hgt} width=${bw * 0.9} height=${hgt} class=${`bar s${j}`}><title>${s.date} · ${k.label}: ${money(s[k.key], k.cur)}</title></rect>`;
        }),
      )}
      ${series.length <= 31 && series.map((s, i) => (i % Math.ceil(series.length / 8) === 0 ? html`<text x=${i * step + 2} y=${H + 14} class="tick">${s.date.slice(5)}</text>` : null))}
    </svg>
    <figcaption class="row gap">${keys.map((k, j) => html`<span class="legend"><i class=${`s${j}`}></i>${k.label}</span>`)}</figcaption>
  </figure>`;
}

export function downloadUrl(path) {
  const a = document.createElement('a');
  a.href = path;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Reads a local file as text (for CSV import). */
export const readFile = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsText(file, 'utf-8');
  });
