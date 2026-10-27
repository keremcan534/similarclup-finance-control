// Declarative create/update for master-data tables, with validation and audit.
// Ledger tables never go through here: they have no update path at all.

import { audit, currency, type Ctx } from '../context.ts';
import { bad, bool, date, int, notFound, oneOf, str } from './http.ts';
import { dec, isDecString, parseMinor } from './money.ts';

export type Field =
  | { name: string; type: 'text'; required?: boolean; max?: number }
  | { name: string; type: 'int'; required?: boolean; min?: number; max?: number }
  | { name: string; type: 'date'; required?: boolean }
  | { name: string; type: 'enum'; values: readonly string[]; required?: boolean; def?: string }
  | { name: string; type: 'decimal'; required?: boolean; min?: string; max?: string }
  | { name: string; type: 'money'; column: string; currencyField: string; required?: boolean; allowNegative?: boolean }
  | { name: string; type: 'bool' }
  | { name: string; type: 'json' }
  | { name: string; type: 'ref'; table: string; required?: boolean };

export type Resource = { table: string; label: string; fields: Field[]; immutable?: string[] };

function convert(ctx: Ctx, f: Field, v: unknown, row: Record<string, unknown>): [string, unknown] {
  const label = f.name;
  switch (f.type) {
    case 'text':
      return [f.name, str(v, label, { required: f.required, max: f.max ?? 500 })];
    case 'int':
      return [f.name, int(v, label, { required: f.required, min: f.min, max: f.max })];
    case 'date':
      return [f.name, date(v, label, !!f.required)];
    case 'enum':
      return [f.name, v === undefined || v === null || v === '' ? (f.required ? oneOf(v, label, f.values) : (f.def ?? null)) : oneOf(v, label, f.values)];
    case 'decimal': {
      if (v === undefined || v === null || v === '') {
        if (f.required) throw bad(`${label} zorunlu`);
        return [f.name, null];
      }
      if (!isDecString(v)) throw bad(`${label} ondalık sayı olmalı`);
      if (f.min !== undefined && dec(v as string) < dec(f.min)) throw bad(`${label} en az ${f.min}`);
      if (f.max !== undefined && dec(v as string) > dec(f.max)) throw bad(`${label} en fazla ${f.max}`);
      return [f.name, String(v).trim()];
    }
    case 'money': {
      if (v === undefined || v === null || v === '') {
        if (f.required) throw bad(`${label} zorunlu`);
        return [f.column, 0n];
      }
      const cur = row[f.currencyField];
      if (typeof cur !== 'string') throw bad(`${label} için para birimi gerekli`);
      const m = parseMinor(String(v), currency(ctx.db, cur).decimals);
      if (m < 0n && !f.allowNegative) throw bad(`${label} negatif olamaz`);
      return [f.column, m];
    }
    case 'bool':
      return [f.name, v === undefined ? 0 : bool(v) ? 1 : 0];
    case 'json':
      return [f.name, JSON.stringify(v ?? {})];
    case 'ref': {
      const id = int(v, label, { required: f.required });
      if (id !== null && !ctx.db.get(`SELECT 1 FROM ${f.table} WHERE id = ?`, id)) throw bad(`${label}: kayıt bulunamadı`);
      return [f.name, id];
    }
  }
}

export function createRow(ctx: Ctx, r: Resource, body: any, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {};
  // currency first so money fields can use it
  for (const f of r.fields) if (f.type !== 'money') {
    const [k, v] = convert(ctx, f, body?.[f.name], body ?? {});
    row[k] = v;
  }
  for (const f of r.fields) if (f.type === 'money') {
    const [k, v] = convert(ctx, f, body?.[f.name], row);
    row[k] = v;
  }
  Object.assign(row, extra);
  const cols = Object.keys(row);
  const id = ctx.db.run(`INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...(Object.values(row) as any[])).id;
  audit(ctx, `${r.table}.create`, r.table, id, null, row);
  return ctx.db.get(`SELECT * FROM ${r.table} WHERE id = ?`, id);
}

/** Partial update: only fields present in the body change; immutable fields are rejected. */
export function updateRow(ctx: Ctx, r: Resource, id: number, body: any, reason?: string | null) {
  const before = ctx.db.get(`SELECT * FROM ${r.table} WHERE id = ?`, id);
  if (!before) throw notFound(r.label);
  const patch: Record<string, unknown> = {};
  const merged = { ...before, ...body };
  for (const f of r.fields) {
    if (!(f.name in (body ?? {}))) continue;
    if (r.immutable?.includes(f.name)) throw bad(`${f.name} sonradan değiştirilemez; yeni kayıt oluşturun`);
    const [k, v] = convert(ctx, f, body[f.name], merged);
    patch[k] = v;
  }
  if (!Object.keys(patch).length) return before;
  ctx.db.run(`UPDATE ${r.table} SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...(Object.values(patch) as any[]), id);
  const after = ctx.db.get(`SELECT * FROM ${r.table} WHERE id = ?`, id);
  audit(ctx, `${r.table}.update`, r.table, id, Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])), patch, reason);
  return after;
}
