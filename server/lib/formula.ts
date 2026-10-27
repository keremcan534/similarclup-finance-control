// Safe formula language for commission and cost rules. No eval, no property access,
// no user-defined functions: only numbers, whitelisted variables, arithmetic,
// comparisons, logic and the functions in FUNCTIONS. All arithmetic is fixed-point (money.ts).
//
//   net_collected * pct(tier(agency_revenue, 0, 10, 10000, 12, 50000, 15))
//   if(active_publishers >= 20, 500, 0) + min(gross_sales * 0.01, 250)

import { HUNDRED, MoneyError, ONE, SCALE, ZERO, dec, div, divRound, mul, round as roundDec, type Dec } from './money.ts';

export class FormulaError extends Error {
  pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.pos = pos;
  }
}

type Node =
  | { k: 'num'; v: Dec; pos: number }
  | { k: 'var'; name: string; pos: number }
  | { k: 'un'; op: '-' | '!'; a: Node; pos: number }
  | { k: 'bin'; op: string; a: Node; b: Node; pos: number }
  | { k: 'cond'; c: Node; a: Node; b: Node; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number };

type Tok = { t: 'num' | 'id' | 'op' | 'end'; v: string; pos: number };

const MAX_LEN = 2000;
const MAX_DEPTH = 40;
const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '(', ')', ',', '<', '>', '!', '?', ':'];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Beklenmeyen karakter "${c}"`, i);
    out.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

function parse(src: string): Node {
  if (src.length > MAX_LEN) throw new FormulaError(`Formül en fazla ${MAX_LEN} karakter olabilir`);
  const toks = lex(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`"${v}" bekleniyordu`, peek().pos);
    p++;
  };
  const enter = (pos: number) => {
    if (++depth > MAX_DEPTH) throw new FormulaError('Formül çok derin iç içe', pos);
  };

  const binary = (next: () => Node, ops: string[]): (() => Node) => () => {
    let a = next();
    while (peek().t === 'op' && ops.includes(peek().v)) {
      const t = toks[p++];
      a = { k: 'bin', op: t.v, a, b: next(), pos: t.pos };
    }
    return a;
  };

  const primary = (): Node => {
    const t = peek();
    if (t.t === 'num') {
      p++;
      return { k: 'num', v: dec(t.v.endsWith('.') ? t.v + '0' : t.v.startsWith('.') ? '0' + t.v : t.v), pos: t.pos };
    }
    if (t.t === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          do args.push(expr());
          while (isOp(',') && ++p);
        }
        expect(')');
        return { k: 'call', name: t.v, args, pos: t.pos };
      }
      return { k: 'var', name: t.v, pos: t.pos };
    }
    if (isOp('(')) {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    throw new FormulaError(t.t === 'end' ? 'Formül eksik bitiyor' : `Beklenmeyen "${t.v}"`, t.pos);
  };
  const unary = (): Node => {
    if (isOp('-') || isOp('!')) {
      const t = toks[p++];
      enter(t.pos);
      const a = unary();
      depth--;
      return { k: 'un', op: t.v as '-' | '!', a, pos: t.pos };
    }
    return primary();
  };
  const mulE = binary(unary, ['*', '/']);
  const addE = binary(mulE, ['+', '-']);
  const cmpE = binary(addE, ['<', '<=', '>', '>=', '==', '!=']);
  const andE = binary(cmpE, ['&&']);
  const orE = binary(andE, ['||']);
  function expr(): Node {
    enter(peek().pos);
    const c = orE();
    let out = c;
    if (isOp('?')) {
      const pos = toks[p++].pos;
      const a = expr();
      expect(':');
      const b = expr();
      out = { k: 'cond', c, a, b, pos };
    }
    depth--;
    return out;
  }
  const root = expr();
  if (peek().t !== 'end') throw new FormulaError(`Fazladan "${peek().v}"`, peek().pos);
  return root;
}

const bool = (b: boolean): Dec => (b ? ONE : ZERO);
const truthy = (d: Dec) => d !== ZERO;

type Fn = { min: number; max: number; doc: string; run: (a: Dec[], pos: number) => Dec };

/** Step rate: tier(x, t0, r0, t1, r1, ...) → r of the highest threshold ≤ x. */
function tier(a: Dec[], pos: number): Dec {
  const [x, ...pairs] = a;
  if (pairs.length < 2 || pairs.length % 2) throw new FormulaError('tier(x, eşik, değer, ...) çift sayıda eşik/değer ister', pos);
  let out = ZERO;
  for (let i = 0; i < pairs.length; i += 2) if (x >= pairs[i]) out = pairs[i + 1];
  return out;
}

/** Marginal brackets: marginal(x, t0, p0, t1, p1, ...) = Σ portion in bracket × p / 100. */
function marginal(a: Dec[], pos: number): Dec {
  const [x, ...pairs] = a;
  if (pairs.length < 2 || pairs.length % 2) throw new FormulaError('marginal(x, eşik, yüzde, ...) çift sayıda eşik/yüzde ister', pos);
  let total = ZERO;
  for (let i = 0; i < pairs.length; i += 2) {
    const from = pairs[i];
    const to = i + 2 < pairs.length ? pairs[i + 2] : null;
    if (x <= from) break;
    const top = to === null || x < to ? x : to;
    total += divRound((top - from) * pairs[i + 1], HUNDRED);
  }
  return total;
}

export const FUNCTIONS: Record<string, Fn> = {
  min: { min: 1, max: 50, doc: 'min(a, b, ...) en küçük', run: (a) => a.reduce((m, x) => (x < m ? x : m)) },
  max: { min: 1, max: 50, doc: 'max(a, b, ...) en büyük', run: (a) => a.reduce((m, x) => (x > m ? x : m)) },
  abs: { min: 1, max: 1, doc: 'abs(x) mutlak değer', run: ([x]) => (x < 0n ? -x : x) },
  pct: { min: 1, max: 1, doc: 'pct(40) = 0,40', run: ([x]) => divRound(x, 100n) },
  if: { min: 3, max: 3, doc: 'if(koşul, doğruysa, yanlışsa)', run: ([c, a, b]) => (truthy(c) ? a : b) },
  clamp: { min: 3, max: 3, doc: 'clamp(x, alt, üst)', run: ([x, lo, hi]) => (x < lo ? lo : x > hi ? hi : x) },
  round: {
    min: 1,
    max: 2,
    doc: 'round(x, basamak) yarımda çifte yuvarlar',
    run: ([x, places], pos) => {
      const n = places === undefined ? 0 : Number(places / SCALE);
      if (places !== undefined && (places % SCALE !== 0n || n < 0 || n > 12)) throw new FormulaError('round basamak sayısı 0–12 tam sayı olmalı', pos);
      return roundDec(x, n, 'half_even');
    },
  },
  floor: { min: 1, max: 1, doc: 'floor(x) aşağı tam sayı', run: ([x]) => roundDec(x, 0, 'floor') },
  ceil: { min: 1, max: 1, doc: 'ceil(x) yukarı tam sayı', run: ([x]) => roundDec(x, 0, 'ceil') },
  tier: { min: 3, max: 61, doc: 'tier(x, eşik0, değer0, eşik1, değer1, ...) kademeli oran', run: tier },
  marginal: { min: 3, max: 61, doc: 'marginal(x, eşik0, %0, eşik1, %1, ...) dilimli tutar', run: marginal },
};

function evalNode(n: Node, vars: Record<string, Dec>): Dec {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var': {
      const v = Object.hasOwn(vars, n.name) ? vars[n.name] : undefined;
      if (typeof v !== 'bigint') throw new FormulaError(`Tanımsız değişken: ${n.name}`, n.pos);
      return v;
    }
    case 'un': {
      const a = evalNode(n.a, vars);
      return n.op === '-' ? -a : bool(!truthy(a));
    }
    case 'cond':
      return truthy(evalNode(n.c, vars)) ? evalNode(n.a, vars) : evalNode(n.b, vars);
    case 'call': {
      const fn = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
      if (!fn) throw new FormulaError(`Bilinmeyen fonksiyon: ${n.name}`, n.pos);
      // if() is lazy so the untaken branch cannot fail (e.g. division by zero).
      if (n.name === 'if') return truthy(evalNode(n.args[0], vars)) ? evalNode(n.args[1], vars) : evalNode(n.args[2], vars);
      return fn.run(n.args.map((a) => evalNode(a, vars)), n.pos);
    }
    case 'bin': {
      if (n.op === '&&') return bool(truthy(evalNode(n.a, vars)) && truthy(evalNode(n.b, vars)));
      if (n.op === '||') return bool(truthy(evalNode(n.a, vars)) || truthy(evalNode(n.b, vars)));
      const a = evalNode(n.a, vars);
      const b = evalNode(n.b, vars);
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return mul(a, b);
        case '/':
          if (b === ZERO) throw new FormulaError('Sıfıra bölme', n.pos);
          return div(a, b);
        case '<':
          return bool(a < b);
        case '<=':
          return bool(a <= b);
        case '>':
          return bool(a > b);
        case '>=':
          return bool(a >= b);
        case '==':
          return bool(a === b);
        case '!=':
          return bool(a !== b);
      }
    }
  }
  throw new FormulaError('Geçersiz ifade');
}

function collect(n: Node, vars: Set<string>, errs: { message: string; pos: number }[]) {
  switch (n.k) {
    case 'var':
      vars.add(n.name);
      return;
    case 'un':
      return collect(n.a, vars, errs);
    case 'bin':
      collect(n.a, vars, errs);
      return collect(n.b, vars, errs);
    case 'cond':
      collect(n.c, vars, errs);
      collect(n.a, vars, errs);
      return collect(n.b, vars, errs);
    case 'call': {
      const fn = Object.hasOwn(FUNCTIONS, n.name) ? FUNCTIONS[n.name] : undefined;
      if (!fn) errs.push({ message: `Bilinmeyen fonksiyon: ${n.name}`, pos: n.pos });
      else if (n.args.length < fn.min || n.args.length > fn.max)
        errs.push({ message: `${n.name} ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`} argüman alır (${n.args.length} verildi)`, pos: n.pos });
      n.args.forEach((a) => collect(a, vars, errs));
    }
  }
}

const cache = new Map<string, Node>();
function compile(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = parse(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, n);
  }
  return n;
}

export type Validation = { ok: boolean; errors: { message: string; pos: number }[]; variables: string[] };

/** Syntax + whitelist check, without evaluating. */
export function validateFormula(src: string, allowed?: Iterable<string>): Validation {
  let node: Node;
  try {
    node = compile(src);
  } catch (e) {
    if (e instanceof FormulaError || e instanceof MoneyError) return { ok: false, errors: [{ message: e.message, pos: e instanceof FormulaError ? e.pos : -1 }], variables: [] };
    throw e;
  }
  const vars = new Set<string>();
  const errors: { message: string; pos: number }[] = [];
  collect(node, vars, errors);
  if (allowed) {
    const set = new Set(allowed);
    for (const v of vars) if (!set.has(v)) errors.push({ message: `İzin verilmeyen değişken: ${v}`, pos: src.indexOf(v) });
  }
  return { ok: errors.length === 0, errors, variables: [...vars].sort() };
}

export function evaluate(src: string, vars: Record<string, Dec>): Dec {
  return evalNode(compile(src), vars);
}
