// Growth scenarios and break-even (monthly, 30 days). Every output is a projection from the
// inputs shown next to it — never mixed with actuals. Money inputs are in the reporting currency.

import type { Db } from '../db.ts';
import { setting } from '../context.ts';
import { bad } from '../lib/http.ts';
import { HUNDRED, ZERO, dec, div, fmt, isDecString, mul, pctOf, type Dec } from '../lib/money.ts';

export const SIM_INPUTS: { key: string; label: string; def: string; unit: string }[] = [
  { key: 'users', label: 'Toplam kayıtlı kullanıcı', def: '1000', unit: 'kişi' },
  { key: 'dau_percent', label: 'Günlük aktif kullanıcı oranı', def: '30', unit: '%' },
  { key: 'concurrent_percent', label: 'Eşzamanlı kullanıcı (DAU içinde)', def: '10', unit: '%' },
  { key: 'app_minutes', label: 'Kullanıcı başına günlük uygulama süresi', def: '45', unit: 'dk' },
  { key: 'voice_minutes', label: 'Kullanıcı başına günlük sesli oda süresi', def: '30', unit: 'dk' },
  { key: 'video_minutes', label: 'Kullanıcı başına günlük görüntülü görüşme', def: '3', unit: 'dk' },
  { key: 'paying_percent', label: 'Jeton satın alan kullanıcı oranı (aylık, DAU)', def: '4', unit: '%' },
  { key: 'arppu', label: 'Ücretli kullanıcı başına aylık ortalama tahsilat', def: '400', unit: 'para' },
  { key: 'refund_percent', label: 'İade oranı', def: '2', unit: '%' },
  { key: 'store_fee_percent', label: 'Ortalama ödeme kanalı kesintisi', def: '15', unit: '%' },
  { key: 'tax_percent', label: 'Vergi (brüt içinden)', def: '20', unit: '%' },
  { key: 'gift_percent', label: 'Jetonların hediyeye harcanan oranı', def: '80', unit: '%' },
  { key: 'agency_percent', label: 'Ajans komisyonu (hediye değeri üzerinden)', def: '10', unit: '%' },
  { key: 'bd_percent', label: 'BD komisyonu (hediye değeri üzerinden)', def: '2', unit: '%' },
  { key: 'publisher_percent', label: 'Yayıncı hakedişi (hediye değeri üzerinden)', def: '40', unit: '%' },
  { key: 'game_cost_per_dau', label: 'Oyun ve hediye maliyeti / DAU / ay', def: '0.5', unit: 'para' },
  { key: 'fixed_monthly', label: 'Sabit aylık gider', def: '150000', unit: 'para' },
  { key: 'server_per_dau', label: 'Sunucu maliyeti / DAU / ay', def: '1.2', unit: 'para' },
  { key: 'voice_price_per_min', label: 'Sesli dakika maliyeti', def: '0.004', unit: 'para' },
  { key: 'video_price_per_min', label: 'Görüntülü dakika maliyeti', def: '0.03', unit: 'para' },
  { key: 'collection_delay_days', label: 'Tahsilat gecikmesi', def: '30', unit: 'gün' },
  { key: 'payout_delay_days', label: 'Hakediş ödeme gecikmesi', def: '15', unit: 'gün' },
];
export const PRESET_USERS = ['100', '500', '1000', '5000', '10000'];

type Inputs = Record<string, Dec>;

export function parseInputs(raw: Record<string, unknown>): Inputs {
  const out: Inputs = {};
  const errs: string[] = [];
  for (const i of SIM_INPUTS) {
    const v = raw?.[i.key] ?? i.def;
    if (!isDecString(v)) errs.push(`${i.label} sayısal olmalı`);
    else if (dec(v as string) < ZERO) errs.push(`${i.label} negatif olamaz`);
    else out[i.key] = dec(v as string);
  }
  if (errs.length) throw bad('Simülasyon girdileri geçersiz', errs);
  return out;
}

const D30 = dec(30);
const r2 = (d: Dec) => fmt(d, 2);

export function project(inp: Inputs) {
  const dau = pctOf(inp.users, inp.dau_percent);
  const payers = pctOf(dau, inp.paying_percent);
  const gross = mul(payers, inp.arppu);
  const refunds = pctOf(gross, inp.refund_percent);
  const tax = div(mul(gross - refunds, inp.tax_percent), HUNDRED + inp.tax_percent);
  const fees = pctOf(gross - refunds, inp.store_fee_percent);
  const net = gross - refunds - tax - fees;
  const giftValue = pctOf(net, inp.gift_percent);
  const agency = pctOf(giftValue, inp.agency_percent);
  const bd = pctOf(giftValue, inp.bd_percent);
  const publisher = pctOf(giftValue, inp.publisher_percent);
  const commissions = agency + bd + publisher;
  const voiceMin = mul(mul(dau, inp.voice_minutes), D30);
  const videoMin = mul(mul(dau, inp.video_minutes), D30);
  const server = mul(dau, inp.server_per_dau);
  const media = mul(voiceMin, inp.voice_price_per_min) + mul(videoMin, inp.video_price_per_min);
  const game = mul(dau, inp.game_cost_per_dau);
  const technical = server + media;
  const variable = commissions + technical + game;
  const opex = variable + inp.fixed_monthly;
  const result = net - opex;
  // Working capital: revenue arrives `collection_delay_days` late, payouts leave `payout_delay_days` late.
  const receivable = div(mul(net, inp.collection_delay_days), D30);
  const payable = div(mul(commissions, inp.payout_delay_days), D30);
  const cashNeed = (result < ZERO ? -result : ZERO) + (receivable - payable > ZERO ? receivable - payable : ZERO);
  // Break-even: contribution margin per unit of gross revenue.
  const revenueVariable = commissions + fees + tax + refunds; // scales with revenue
  const marginRatio = gross > ZERO ? div(gross - revenueVariable, gross) : ZERO; // share of gross left after revenue-linked costs
  const fixedLike = inp.fixed_monthly + technical + game; // scale with users, not revenue
  const breakevenGross = marginRatio > ZERO ? div(fixedLike, marginRatio) : null;
  const perPayerContribution = payers > ZERO ? div(mul(gross, marginRatio), payers) : ZERO;
  const breakevenPayers = perPayerContribution > ZERO ? div(fixedLike, perPayerContribution) : null;
  const breakevenPayingPercent = breakevenPayers !== null && dau > ZERO ? div(mul(breakevenPayers, HUNDRED), dau) : null;
  const marginalPerUser = inp.users > ZERO ? div(mul(dau, inp.server_per_dau + inp.game_cost_per_dau) + media, inp.users) : ZERO;
  return {
    dau: r2(dau),
    concurrent: r2(pctOf(dau, inp.concurrent_percent)),
    paying_users: r2(payers),
    gross_revenue: r2(gross),
    refunds: r2(refunds),
    taxes: r2(tax),
    channel_fees: r2(fees),
    net_revenue: r2(net),
    commissions: { agency: r2(agency), bd: r2(bd), publisher: r2(publisher), total: r2(commissions) },
    technical: { server: r2(server), voice_video: r2(media), total: r2(technical), voice_minutes: r2(voiceMin), video_minutes: r2(videoMin) },
    game_and_gift_costs: r2(game),
    fixed_costs: r2(inp.fixed_monthly),
    operating_costs: r2(opex),
    net_result: r2(result),
    cash_need: r2(cashNeed),
    breakeven_gross_revenue: breakevenGross === null ? null : r2(breakevenGross),
    breakeven_paying_users: breakevenPayers === null ? null : r2(breakevenPayers),
    breakeven_paying_percent: breakevenPayingPercent === null ? null : r2(breakevenPayingPercent),
    marginal_cost_per_user: r2(marginalPerUser),
  };
}

export function runSimulation(db: Db, raw: Record<string, unknown>, presets = PRESET_USERS) {
  const base = parseInputs(raw);
  const scenarios = presets.map((u) => ({ users: u, ...project({ ...base, users: dec(u) }) }));
  return {
    currency: setting(db, 'reporting_currency'),
    inputs: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, fmt(v)])),
    custom: project(base),
    scenarios,
    disclaimer: 'Tahmindir; girilen varsayımlara dayanır. Gerçek kapasite veya maliyet garantisi değildir ve gerçekleşen verilerle karıştırılmaz.',
  };
}
