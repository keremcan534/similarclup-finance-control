// Threshold alerts. Limits are entered in the reporting currency (major units, decimal strings).

import type { Db } from '../db.ts';
import { currency, setting, today, type Ctx } from '../context.ts';
import { bad } from '../lib/http.ts';
import { dec, fmt, fromMinor, isDecString, toMinor } from '../lib/money.ts';
import { monthEnd, monthStart } from './costs.ts';
import { luckyAnalysis } from './lucky.ts';
import { summary } from './reports.ts';

export const ALERT_KINDS: Record<string, { label: string; params: string[]; action: string }> = {
  daily_spend_max: { label: 'Günlük maksimum harcama', params: ['limit'], action: 'Günün gider ve komisyon kalemlerini inceleyin' },
  monthly_spend_max: { label: 'Aylık maksimum harcama', params: ['limit'], action: 'Bütçe ve gider kategorilerini gözden geçirin' },
  service_cost_max: { label: 'Servis bazında maksimum maliyet', params: ['provider', 'limit'], action: 'Sağlayıcı kullanımını ve tarifesini kontrol edin' },
  cost_per_user_max: { label: 'Kullanıcı başına maksimum maliyet', params: ['limit'], action: 'Kullanıcı başına servis maliyetini inceleyin' },
  expense_spike: { label: 'Giderde ani artış', params: ['percent'], action: 'Önceki aya göre artan kalemleri inceleyin' },
  min_cash: { label: 'Minimum nakit rezervi', params: ['limit'], action: 'Ödeme takvimini ve tahsilatları gözden geçirin' },
  max_pending_payouts: { label: 'Maksimum bekleyen hakediş', params: ['limit'], action: 'Bekleyen hakedişleri onaylayın veya ödeyin' },
  budget_overrun: { label: 'Bütçe aşımı', params: [], action: 'Bütçe kalemini ve harcamaları inceleyin' },
  commission_over_limit: { label: 'Komisyon toplamı dağıtılabilir tutarı aşıyor', params: [], action: 'Komisyon kurallarının toplam oranını düzeltin, sonra yeniden hesaplayın' },
  integration_down: { label: 'Entegrasyon bağlantısı koptu', params: ['hours'], action: 'Entegrasyon ayarlarını ve sağlayıcı durumunu kontrol edin' },
  invoice_mismatch: { label: 'Fatura ile sistem hesabı farkı', params: ['percent'], action: 'Kullanım kayıtlarını ve tarifeyi faturayla karşılaştırın' },
  lucky_reserve: { label: 'Lucky Gift ödül rezervi azaldı', params: [], action: 'Ödül bütçesini artırın veya olasılık tablosunu gözden geçirin' },
  unusual_coin_movement: { label: 'Olağandışı jeton hareketi', params: ['units'], action: 'İşlemi ve kullanıcıyı inceleyin' },
  inconsistent_balance: { label: 'Tutarsız bakiye / çözülmemiş hesaplama', params: [], action: 'Hesaplama sorunlarını çözün' },
  negative_result: { label: 'Negatif işletme sonucu', params: [], action: 'Gelir-gider raporunu inceleyin' },
  due_payments: { label: 'Yaklaşan ödeme vadeleri', params: ['days'], action: 'Vadesi yaklaşan ödemeleri planlayın' },
};

export function validateAlertParams(kind: string, params: any) {
  const k = ALERT_KINDS[kind];
  if (!k) throw bad(`Bilinmeyen uyarı türü: ${kind}`);
  for (const p of k.params) {
    if (p === 'provider') continue;
    if (!isDecString(params?.[p])) throw bad(`${k.label}: "${p}" sayısal bir değer olmalı`);
  }
  return params ?? {};
}

type Hit = { message: string; ref: string | null; key: string };

function evaluateRule(db: Db, r: any, day: string, cache: { month?: ReturnType<typeof summary>; day?: ReturnType<typeof summary> }): Hit[] {
  const p = JSON.parse(r.params || '{}');
  const cur = setting(db, 'reporting_currency');
  const c = currency(db, cur);
  const limit = p.limit !== undefined ? toMinor(dec(p.limit), c.decimals) : 0n;
  const money = (m: bigint) => `${fmt(fromMinor(m, c.decimals), c.decimals)} ${cur}`;
  const month = day.slice(0, 7);
  const ms = () => (cache.month ??= summary(db, monthStart(month), day, day));
  const ds = () => (cache.day ??= summary(db, day, day, day));
  switch (r.kind) {
    case 'daily_spend_max': {
      const v = ds().totals.expense_total;
      return v > limit ? [{ message: `Bugünkü harcama ${money(v)} (sınır ${money(limit)})`, ref: day, key: day }] : [];
    }
    case 'monthly_spend_max': {
      const v = ms().totals.expense_total;
      return v > limit ? [{ message: `Bu ayki harcama ${money(v)} (sınır ${money(limit)})`, ref: month, key: month }] : [];
    }
    case 'service_cost_max': {
      const by = ms().services.by_provider;
      return Object.entries(by)
        .filter(([name, v]) => (!p.provider || name === p.provider) && v > limit)
        .map(([name, v]) => ({ message: `${name} bu ay ${money(v)} (sınır ${money(limit)})`, ref: name, key: `${month}:${name}` }));
    }
    case 'cost_per_user_max': {
      const users = db.value<number>('SELECT COUNT(DISTINCT user_ref) FROM wallet_transactions WHERE user_ref IS NOT NULL AND booked_on BETWEEN ? AND ?', monthStart(month), day) ?? 0;
      if (!users) return [];
      const per = ms().totals.expense_total / BigInt(users);
      return per > limit ? [{ message: `Aktif kullanıcı başına maliyet ${money(per)} (${users} kullanıcı, sınır ${money(limit)})`, ref: month, key: month }] : [];
    }
    case 'expense_spike': {
      const prevEnd = new Date(Date.parse(monthStart(month)) - 86_400_000).toISOString().slice(0, 10);
      const prev = summary(db, monthStart(prevEnd.slice(0, 7)), prevEnd, prevEnd).totals.expense_total;
      const cur2 = ms().totals.expense_total;
      // compare month-to-date with the same number of days last month, scaled
      const dDays = Number(day.slice(8, 10));
      const prevDays = Number(prevEnd.slice(8, 10));
      if (prev <= 0n) return [];
      const scaled = (prev * BigInt(dDays)) / BigInt(prevDays);
      const pct = scaled > 0n ? Number(((cur2 - scaled) * 10000n) / scaled) / 100 : 0;
      return pct > Number(p.percent) ? [{ message: `Giderler önceki aya göre %${pct} arttı (eşik %${p.percent})`, ref: month, key: month }] : [];
    }
    case 'min_cash': {
      const cash = ms().totals.cash;
      if (cash === null) return [{ message: 'Nakit bakiyesi verisi yok — minimum nakit kontrol edilemiyor', ref: null, key: `nodata:${day}` }];
      return cash < limit ? [{ message: `Nakit ${money(cash)} minimum rezervin (${money(limit)}) altında`, ref: day, key: day }] : [];
    }
    case 'max_pending_payouts': {
      const t = ms().totals;
      const v = t.pending_agency + t.pending_bd + t.pending_publisher;
      return v > limit ? [{ message: `Bekleyen hakediş toplamı ${money(v)} (sınır ${money(limit)})`, ref: day, key: day }] : [];
    }
    case 'budget_overrun': {
      const s = ms();
      return db.all('SELECT * FROM budgets WHERE period = ?', month).flatMap((b) => {
        let spent: bigint;
        if (b.scope_type === 'total') spent = s.totals.expense_total;
        else if (b.scope_type === 'expense_category') {
          const name = db.value<string>('SELECT name FROM expense_categories WHERE id = ?', b.scope_id) ?? '';
          spent = s.expenses.by_category[name] ?? 0n;
        } else {
          const name = db.value<string>('SELECT name FROM service_providers WHERE id = ?', b.scope_id) ?? '';
          spent = s.services.by_provider[name] ?? 0n;
        }
        const lim = b.currency === cur ? BigInt(b.limit_minor) : null;
        return lim !== null && spent > lim ? [{ message: `"${b.name}" bütçesi aşıldı: ${money(spent)} / ${money(lim)}`, ref: `budget:${b.id}`, key: `${month}:${b.id}` }] : [];
      });
    }
    case 'commission_over_limit':
      return db.all("SELECT * FROM calculation_issues WHERE status = 'open' AND kind = 'over_distribution'").map((i) => ({ message: i.message, ref: `${i.tx_kind}:${i.tx_id}`, key: `${i.tx_kind}:${i.tx_id}` }));
    case 'integration_down': {
      const cutoff = new Date(Date.parse(day + 'T23:59:59Z') - Number(p.hours) * 3_600_000).toISOString();
      return db
        .all("SELECT * FROM integration_connections WHERE status IN ('connected','error') AND (status = 'error' OR last_sync_at IS NULL OR last_sync_at < ?)", cutoff)
        .map((i) => ({ message: `${i.name}: ${i.status === 'error' ? `hata — ${i.last_error ?? ''}` : `${p.hours} saattir veri yok`}`, ref: `integration:${i.id}`, key: `${i.id}:${day}` }));
    }
    case 'invoice_mismatch':
      return db
        .all("SELECT * FROM reconciliations WHERE status = 'difference' AND kind = 'service_invoice'")
        .filter((r2) => r2.system_minor === 0 || Math.abs(r2.difference_minor) * 100 > Math.abs(r2.system_minor) * Number(p.percent))
        .map((r2) => ({ message: `${r2.ref} (${r2.period}) fatura farkı ${fmt(fromMinor(r2.difference_minor, currency(db, r2.currency).decimals))} ${r2.currency}`, ref: r2.ref, key: `rec:${r2.id}` }));
    case 'lucky_reserve':
      return luckyAnalysis(db, '0000-01-01', '9999-12-31')
        .filter((l) => l.reserve_warning)
        .map((l) => ({ message: `${l.name} v${l.version}: kalan ödül bütçesi ${l.reserve_left} jeton, rezerv ${l.reserve_coins}`, ref: `lucky:${l.code}`, key: `${l.code}:${l.version}` }));
    case 'unusual_coin_movement': {
      const units = Number(p.units);
      const big = db.all('SELECT id, type, user_ref, units FROM wallet_transactions WHERE booked_on = ? AND ABS(units) >= ? ORDER BY ABS(units) DESC LIMIT 20', day, units);
      const odd = luckyAnalysis(db, day, day + 'T23:59:59.999Z').flatMap((l) => l.distribution.filter((d) => d.unusual && d.count >= 5).map((d) => ({ l, d })));
      return [
        ...big.map((b) => ({ message: `${b.type} işleminde ${b.units} jeton (kullanıcı ${b.user_ref ?? '-'})`, ref: `wallet:${b.id}`, key: `w:${b.id}` })),
        ...odd.map(({ l, d }) => ({ message: `${l.name}: ${d.multiplier}x çarpanı beklenenden sapmalı (${d.count} / beklenen ${d.expected_count}, z=${d.z})`, ref: `lucky:${l.code}`, key: `lz:${l.code}:${d.multiplier}:${day}` })),
      ];
    }
    case 'inconsistent_balance': {
      const issues = db.value<number>("SELECT COUNT(*) FROM calculation_issues WHERE status = 'open'") ?? 0;
      const neg = db.all(
        "SELECT user_ref, SUM(units) AS bal FROM wallet_transactions WHERE user_ref IS NOT NULL AND unit = ? GROUP BY user_ref HAVING SUM(units) < 0 LIMIT 20",
        setting(db, 'coin_unit'),
      );
      return [
        ...(issues ? [{ message: `${issues} çözülmemiş hesaplama sorunu var`, ref: null, key: `issues:${day}` }] : []),
        ...neg.map((n) => ({ message: `${n.user_ref} kullanıcısının jeton bakiyesi negatif (${n.bal}) — harcanmış jetonların iadesi/ters ibrazı ya da eksik satın alma kaydı olabilir`, ref: `user:${n.user_ref}`, key: `neg:${n.user_ref}` })),
      ];
    }
    case 'negative_result': {
      const v = ms().totals.operating_result;
      return v < 0n ? [{ message: `Bu ayın işletme sonucu negatif: ${money(v)}`, ref: month, key: month }] : [];
    }
    case 'due_payments': {
      const horizon = new Date(Date.parse(day) + Number(p.days) * 86_400_000).toISOString().slice(0, 10);
      const exp = db.all("SELECT id, description, due_date FROM expense_records WHERE status = 'unpaid' AND due_date IS NOT NULL AND due_date <= ?", horizon);
      const inv = db.all('SELECT i.id, i.invoice_no, i.due_on, p.name FROM service_invoices i JOIN service_providers p ON p.id = i.provider_id WHERE i.paid_on IS NULL AND i.due_on IS NOT NULL AND i.due_on <= ?', horizon);
      return [
        ...exp.map((e) => ({ message: `Gider "${e.description}" vadesi ${e.due_date}`, ref: `expense:${e.id}`, key: `e:${e.id}` })),
        ...inv.map((i) => ({ message: `${i.name} faturası ${i.invoice_no ?? ''} vadesi ${i.due_on}`, ref: `invoice:${i.id}`, key: `i:${i.id}` })),
      ];
    }
  }
  return [];
}

export function evaluateAlerts(ctx: Ctx, day = today(ctx)) {
  const { db } = ctx;
  const cache = {};
  let created = 0;
  const errors: string[] = [];
  for (const r of db.all('SELECT * FROM alert_rules WHERE active = 1')) {
    let hits: Hit[] = [];
    try {
      hits = evaluateRule(db, r, day, cache);
    } catch (e: any) {
      errors.push(`${r.name}: ${e.message}`);
      continue;
    }
    for (const h of hits) {
      const key = `${r.id}:${h.key}`;
      if (db.get("SELECT 1 FROM alerts WHERE dedupe_key = ? AND status <> 'resolved'", key)) continue;
      db.run('INSERT INTO alerts (rule_id, kind, severity, message, ref, suggested_action, dedupe_key) VALUES (?,?,?,?,?,?,?)', r.id, r.kind, r.severity, h.message, h.ref, ALERT_KINDS[r.kind]?.action ?? null, key);
      created++;
    }
  }
  return { created, errors };
}
