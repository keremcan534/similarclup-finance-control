import { App, Button, Card, Form, Toasts, api, get, html, post, render, setCurrencies, setUnauthorizedHandler, showError, useEffect, useState } from './lib.js';
import { Dashboard } from './pages/dashboard.js';
import { Ledger } from './pages/ledger.js';
import { Rules, Approvals } from './pages/rules.js';
import { Parties } from './pages/parties.js';
import { Statements } from './pages/statements.js';
import { Channels, Costs, Catalog } from './pages/costs.js';
import { Lucky } from './pages/lucky.js';
import { Expenses, Cash } from './pages/expenses.js';
import { Reports } from './pages/reports.js';
import { Simulation } from './pages/simulation.js';
import { Alerts } from './pages/alerts.js';
import { Integrations, Users, Audit, Settings, Account } from './pages/admin.js';

const NAV = [
  ['Genel', [
    ['dashboard', 'Ana panel', 'dashboard.view', Dashboard],
    ['alerts', 'Uyarılar', 'alerts.view', Alerts],
    ['approvals', 'Onay bekleyenler', 'rules.view', Approvals],
  ]],
  ['Gelir ve defter', [
    ['ledger', 'İşlem defteri', 'ledger.view', Ledger],
    ['channels', 'Ödeme kanalları', 'ledger.view', Channels],
  ]],
  ['Komisyon ve hakediş', [
    ['rules', 'Komisyon kuralları', 'rules.view', Rules],
    ['agencies', 'Ajanslar', 'parties.view', (p) => html`<${Parties} type="agency" ...${p} />`],
    ['bds', 'BD', 'parties.view', (p) => html`<${Parties} type="bd" ...${p} />`],
    ['publishers', 'Yayıncılar', 'parties.view', (p) => html`<${Parties} type="publisher" ...${p} />`],
    ['statements', 'Hakedişler', 'statements.view', Statements],
  ]],
  ['Maliyet', [
    ['costs', 'Sunucu ve servisler', 'costs.view', Costs],
    ['catalog', 'Oyun, hediye, PK', 'costs.view', Catalog],
    ['lucky', 'Lucky Gift', 'lucky.view', Lucky],
    ['expenses', 'Genel giderler', 'expenses.view', Expenses],
  ]],
  ['Analiz', [
    ['reports', 'Raporlar', 'reports.view', Reports],
    ['cash', 'Nakit ve bütçe', 'reports.view', Cash],
    ['simulation', 'Büyüme simülasyonu', 'simulation.use', Simulation],
  ]],
  ['Yönetim', [
    ['integrations', 'Entegrasyonlar', 'integrations.manage', Integrations],
    ['users', 'Kullanıcılar ve roller', 'users.manage', Users],
    ['audit', 'Denetim kaydı', 'audit.view', Audit],
    ['settings', 'Ayarlar', 'reports.view', Settings],
    ['account', 'Hesabım', null, Account],
  ]],
];
const ROUTES = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([k, label, perm, C]) => [k, { label, perm, C }])));

function useHash() {
  const read = () => {
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    const [route, ...rest] = path.split('/');
    return { route: route || '', rest, query: new URLSearchParams(query) };
  };
  const [h, set] = useState(read);
  useEffect(() => {
    const on = () => set(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

function Login({ onDone }) {
  const [mfa, setMfa] = useState(false);
  return html`<div class="login">
    <${Card} title="Similarclup Finance Control">
      <p class="muted" style="margin-bottom:12px">Bağımsız finansal kontrol paneli. Devam etmek için oturum açın.</p>
      <${Form}
        fields=${[
          { name: 'email', label: 'E-posta', required: true, wide: true },
          { name: 'password', label: 'Parola', type: 'password', required: true, wide: true },
          ...(mfa ? [{ name: 'code', label: 'Doğrulama kodu (6 hane)', required: true, wide: true }] : []),
        ]}
        submitLabel="Giriş yap"
        onSubmit=${async (v) => {
          try {
            await api('POST', '/api/auth/login', v);
            onDone();
          } catch (e) {
            if (e.message.includes('Doğrulama kodu gerekli')) setMfa(true);
            showError(e);
          }
        }}
      />
    </${Card}>
  </div>`;
}

function Shell({ ctx, onLogout }) {
  const hash = useHash();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const visible = NAV.map(([g, items]) => [g, items.filter(([, , perm]) => !perm || ctx.can(perm))]).filter(([, items]) => items.length);
  const first = visible[0]?.[1][0]?.[0] ?? 'account';
  const route = ROUTES[hash.route] && (!ROUTES[hash.route].perm || ctx.can(ROUTES[hash.route].perm)) ? hash.route : first;
  const { C, label } = ROUTES[route];
  useEffect(() => {
    setOpen(false);
    document.title = `${label} · Similarclup Finance`;
  }, [route]);
  useEffect(() => {
    const load = async () => {
      const c = {};
      if (ctx.can('alerts.view')) c.alerts = (await get('/api/alerts?status=open').catch(() => ({ rows: [] }))).rows.length;
      if (ctx.can('rules.view')) c.approvals = (await get('/api/approvals?status=pending').catch(() => ({ rows: [] }))).rows.length;
      setCounts(c);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [route]);
  const demo = ctx.meta.settings?.demo_data === '1';
  return html`<div class="shell">
    <nav class=${`side ${open ? 'open' : ''}`} aria-label="Ana menü">
      <div class="brand"><img src="/favicon.svg" width="26" height="26" alt="" /><div>Finance Control<small>${ctx.meta.settings?.company_name ?? 'Similarclup'}</small></div></div>
      ${visible.map(
        ([g, items]) => html`<div class="nav-g">${g}</div><div class="nav">${items.map(
          ([k, l]) => html`<a href=${`#/${k}`} class=${route === k ? 'on' : ''}>${l}${counts[k] ? html`<span class="count">${counts[k]}</span>` : ''}</a>`,
        )}</div>`,
      )}
    </nav>
    <div class="main" onClick=${() => open && setOpen(false)}>
      <div class="topbar">
        <div class="row gap"><button class="btn ghost menu-btn" aria-label="Menü" onClick=${(e) => (e.stopPropagation(), setOpen(!open))}>☰</button><strong>${label}</strong></div>
        <div class="row gap"><span class="muted">${ctx.user.name} · ${ctx.user.role_name}</span>${!ctx.meta.no_login && html`<${Button} kind="ghost" onClick=${onLogout}>Çıkış</${Button}>`}</div>
      </div>
      ${ctx.meta.no_login && html`<div class="demo-banner">GİRİŞ KAPALI (yerel mod): Panel bu bilgisayardan şifresiz, süper yönetici olarak açılıyor. Açmak için .env içindeki FC_NO_LOGIN satırını silin.</div>`}
      ${demo && html`<div class="demo-banner">DEMO VERİSİ: Bu veritabanındaki işlemler örnek amaçlıdır; gerçek Similar Club verisi değildir.</div>`}
      <${C} key=${route} rest=${hash.rest} query=${hash.query} />
    </div>
  </div>`;
}

function Root() {
  const [ctx, setCtx] = useState(undefined);
  const load = async () => {
    try {
      const { user } = await get('/api/auth/me');
      const meta = await get('/api/meta');
      setCurrencies(meta.currencies);
      const perms = new Set(user.permissions);
      setCtx({ user, meta, can: (p) => perms.has(p), reloadMeta: load });
    } catch {
      setCtx(null);
    }
  };
  useEffect(() => {
    setUnauthorizedHandler(() => setCtx(null));
    load();
  }, []);
  if (ctx === undefined) return html`<div class="boot">Yükleniyor…</div>`;
  return html`<${App.Provider} value=${ctx}>
    ${ctx ? html`<${Shell} ctx=${ctx} onLogout=${async () => (await post('/api/auth/logout').catch(() => {}), setCtx(null))} />` : html`<${Login} onDone=${load} />`}
    <${Toasts} />
  </${App.Provider}>`;
}

render(html`<${Root} />`, document.getElementById('root'));
