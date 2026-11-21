import { App, Button, Card, Form, Toasts, api, get, html, post, render, searchable, setCurrencies, setUnauthorizedHandler, showError, useEffect, useRef, useState } from './lib.js';
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
import { AppGifts } from './pages/app-gifts.js';
import { AppEmojis } from './pages/app-emojis.js';
import { AppLevels } from './pages/app-levels.js';
import { AppLevelRewards } from './pages/app-level-rewards.js';
import { AppShop } from './pages/app-shop.js';
import { AppRocket } from './pages/app-rocket.js';
import { AppPayouts, AppRefunds, AppReports, AppSettings, AppWithdrawals } from './pages/app-finance.js';
import { AppLucky } from './pages/app-lucky.js';
import { AppComplaints, AppEvents, AppNotices, AppSupport, AppUsers } from './pages/app-ops.js';
import { AppAgencies } from './pages/app-agencies.js';
import { AppAgencyStaff } from './pages/app-agency-staff.js';
import { AppEconomy, AppJeton } from './pages/app-economy.js';
import { AppSanctions } from './pages/app-sanctions.js';
import { AppBonds } from './pages/app-bond-looks.js';

// The menu by subject, the app's own work first. Each page: [route, label, permission, page, words it is found by].
// Routes never change (links and bookmarks keep working); only where a page sits and what it is called do.
const NAV = [
  ['home', 'Ana sayfa', '🏠', [
    ['dashboard', 'Ana panel', 'dashboard.view', Dashboard, 'özet genel bakış'],
    ['alerts', 'Uyarılar', 'alerts.view', Alerts, 'alarm hata sorun'],
    ['approvals', 'Onay bekleyenler', 'rules.view', Approvals, 'onay kural bekleyen'],
  ]],
  ['people', 'Kullanıcılar ve güvenlik', '👥', [
    ['app-users', 'Kullanıcılar', 'app.users', AppUsers, 'hesap üye kişi id kimlik ara bul askıya alma silme oda seviyesi davet profil izi kaka'],
    ['app-sanctions', 'Yaptırımlar', 'app.sanctions', AppSanctions, 'ban yasak engel susturma mute cihaz banı itiraz ceza kademe yetki kanıt'],
    ['app-complaints', 'Şikâyetler', 'app.complaints', AppComplaints, 'şikayet rapor bildirim an yorum oda kapak aile'],
    ['app-support', 'Destek', 'app.support', AppSupport, 'destek talep yardım yanıt'],
  ]],
  ['gifts', 'Hediye ve mağaza', '🎁', [
    ['app-gifts', 'Hediyeler', 'app.gifts', AppGifts, 'hediye video svga ikon animasyon raf fiyat global duyuru profil izi iz türü muzip kaka su kırık cam terlik'],
    ['app-emojis', 'Emojiler', 'app.emojis', AppEmojis, 'emoji çıkartma sticker paket lottie'],
    ['app-shop', 'Mağaza', 'app.shop', AppShop, 'mağaza çerçeve giriş efekti ejderha video svga isim plakası fiyat satış'],
    ['app-economy', 'Mağaza eşyaları (kişiye)', 'app.economy', AppEconomy, 'mağaza eşya çerçeve vip giriş efekti binek balon ver geri al kişi'],
    ['app-lucky', 'Şanslı hediye ayarı', 'app.lucky', AppLucky, 'şanslı lucky çanta olasılık ödül yeni paket ikon video'],
    ['app-bonds', 'Bağlar', 'app.gifts', AppBonds, 'bağ ilişki çift kardeş seviye ikon svga resim hareketli işaret koltuk'],
    ['app-rocket', 'Oda roketi', 'app.rocket', AppRocket, 'roket oda hediye seviye hedef ödül kalkış çekiliş jeton'],
  ]],
  ['levels', 'Seviye ve VIP', '⭐', [
    ['app-levels', 'Seviyeler ve VIP', 'app.levels', AppLevels, 'seviye vip svip rütbe kademe cömertlik yankı cazibe abonelik eşik puan atış hak ödül çerçeve giriş efekti düşme gizle sessiz ziyaret'],
    ['app-level-rewards', 'Seviye ve görev ödülleri', 'app.levels', AppLevelRewards, 'seviye vip cömertlik yankı görev arama ödül çanta çantam çerçeve giriş efekti binek sohbet balonu ses dalgası hediye kazan'],
  ]],
  ['news', 'Duyuru ve etkinlik', '📣', [
    ['app-notices', 'Duyurular', 'app.notices', AppNotices, 'duyuru banner bildirim ekip mesaj'],
    ['app-events', 'Etkinlikler', 'app.events', AppEvents, 'etkinlik başvuru onay ret'],
  ]],
  ['agencies', 'Ajanslar', '🏢', [
    ['app-agencies', 'Ajans merkezi', 'app.agencies', AppAgencies, 'ajans başvuru oran kademe transfer yayıncı bağla üst ajans'],
    ['app-agency-staff', 'Ajans personeli', 'app.agency_staff', AppAgencyStaff, 'personel rol bd operasyon puan ihlal itiraz arka plan'],
    ['app-payouts', 'Ajans ödemeleri', 'app.payouts', AppPayouts, 'ajans ödeme komisyon dekont'],
    ['statements', 'Hakedişler', 'statements.view', Statements, 'hakediş dönem ödeme'],
    ['rules', 'Komisyon kuralları', 'rules.view', Rules, 'komisyon kural oran'],
    ['agencies', 'Ajans hesapları (finans)', 'parties.view', (p) => html`<${Parties} type="agency" ...${p} />`, 'ajans finans taraf'],
    ['bds', 'BD hesapları (finans)', 'parties.view', (p) => html`<${Parties} type="bd" ...${p} />`, 'bd finans taraf'],
    ['publishers', 'Yayıncılar (finans)', 'parties.view', (p) => html`<${Parties} type="publisher" ...${p} />`, 'yayıncı finans taraf'],
  ]],
  ['money', 'Para', '💰', [
    ['app-withdrawals', 'Para çekme', 'app.withdrawals', AppWithdrawals, 'para çekme elmas nakit iban ödeme talebi'],
    ['app-refunds', 'İadeler ve cüzdan', 'app.refunds', AppRefunds, 'iade cüzdan bakiye jeton coin satın alma google play'],
    ['app-jeton', 'Jeton Noktası', 'app.jeton', AppJeton, 'jeton noktası coins bank bayi toptan satış'],
    ['ledger', 'İşlem defteri', 'ledger.view', Ledger, 'işlem defter kayıt gelir satış'],
    ['channels', 'Ödeme kanalları', 'ledger.view', Channels, 'ödeme kanal google apple'],
  ]],
  ['reports', 'Rapor ve maliyet', '📊', [
    ['reports', 'Raporlar', 'reports.view', Reports, 'rapor gelir gider kâr'],
    ['app-reports', 'Oyun Salonu ve durum', 'app.reports', AppReports, 'oyun salonu casino kasa jackpot durum rapor uyarı'],
    ['cash', 'Nakit ve bütçe', 'reports.view', Cash, 'nakit bütçe kasa'],
    ['simulation', 'Büyüme simülasyonu', 'simulation.use', Simulation, 'simülasyon büyüme tahmin'],
    ['costs', 'Sunucu ve servisler', 'costs.view', Costs, 'maliyet sunucu servis fatura'],
    ['catalog', 'Oyun, hediye, PK maliyeti', 'costs.view', Catalog, 'maliyet katalog pk oyun hediye'],
    ['lucky', 'Şanslı hediye maliyeti', 'lucky.view', Lucky, 'lucky gift şanslı maliyet'],
    ['expenses', 'Genel giderler', 'expenses.view', Expenses, 'gider masraf'],
  ]],
  ['settings', 'Ayarlar', '⚙️', [
    ['app-settings', 'Canlı ayarlar', 'app.settings', AppSettings, 'canlı ayar kur kampanya fiyat duyuru acil kapat yönetim sitesi'],
    ['users', 'Panel kullanıcıları ve rolleri', 'users.manage', Users, 'panel kullanıcı rol yetki hesap aç personel moderatör çalışan'],
    ['settings', 'Panel ayarları', 'reports.view', Settings, 'ayar para birimi kur çift onay vergi dönem yedek'],
    ['integrations', 'Entegrasyonlar', 'integrations.manage', Integrations, 'entegrasyon anahtar api'],
    ['audit', 'Denetim kaydı', 'audit.view', Audit, 'denetim kayıt log iz geçmiş'],
    ['account', 'Hesabım', null, Account, 'parola şifre iki adımlı doğrulama 2fa'],
  ]],
];
const ROUTES = Object.fromEntries(NAV.flatMap(([, , , items]) => items.map(([k, label, perm, C]) => [k, { label, perm, C }])));

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
          { name: 'email', label: 'E-posta ya da kullanıcı adı', required: true, wide: true },
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

const CLOSED_KEY = 'fc-nav-closed';
/** Subjects closed in the menu (this computer remembers); at first all but Ana sayfa. The open page's subject is always open. */
const closedAtFirst = () => {
  try {
    const kept = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? 'null');
    if (Array.isArray(kept)) return new Set(kept);
  } catch {}
  return new Set(NAV.map(([key]) => key).filter((key) => key !== 'home'));
};

/** The menu: a search box over every page (by its name, its subject and the words it is found by), then the subjects. */
function NavMenu({ groups, route, counts }) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(closedAtFirst);
  const box = useRef(null);
  useEffect(() => {
    // Ctrl+K (⌘K) or "/" outside a field: to the search box.
    const on = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        box.current?.focus();
        box.current?.select();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const toggle = (key) =>
    setClosed((c) => {
      const next = new Set(c);
      next.has(key) ? next.delete(key) : next.add(key);
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  const words = searchable(q).split(/\s+/).filter(Boolean);
  const found = words.length
    ? groups
        .flatMap(([, g, icon, items]) => items.map(([k, l, , , w]) => ({ k, l, g, icon, hay: searchable(`${l} ${g} ${w ?? ''}`), name: searchable(l) })))
        .filter((x) => words.every((w) => x.hay.includes(w)))
        .sort((a, b) => Number(b.name.startsWith(words[0])) - Number(a.name.startsWith(words[0])))
    : [];
  const link = (k, l, extra = '') => html`<a href=${`#/${k}`} class=${route === k ? 'on' : ''} onClick=${() => setQ('')}><span>${l}${extra}</span>${counts[k] ? html`<span class="count">${counts[k]}</span>` : ''}</a>`;
  return html`
    <div class="nav-search">
      <input ref=${box} type="search" placeholder="Menüde ara (Ctrl+K)" aria-label="Menüde ara" value=${q}
        onInput=${(e) => setQ(e.target.value)}
        onKeyDown=${(e) => {
          if (e.key === 'Enter' && found[0]) {
            location.hash = `#/${found[0].k}`;
            setQ('');
            e.target.blur();
          }
          if (e.key === 'Escape') (setQ(''), e.target.blur());
        }} />
    </div>
    ${words.length
      ? html`<div class="nav found">${found.length ? found.map((x) => link(x.k, x.l, html` <small class="muted">· ${x.g}</small>`)) : html`<p class="muted nav-empty">“${q}” için sayfa yok</p>`}</div>`
      : groups.map(([key, g, icon, items]) => {
          const here = items.some(([k]) => k === route);
          const isOpen = here || !closed.has(key);
          const waiting = items.reduce((n, [k]) => n + (counts[k] ?? 0), 0);
          return html`<div class="nav-group">
            <button class=${`nav-g ${isOpen ? 'open' : ''} ${here ? 'here' : ''}`} aria-expanded=${isOpen} onClick=${() => !here && toggle(key)}>
              <span>${icon} ${g}</span><span class="row gap">${!isOpen && waiting ? html`<span class="count">${waiting}</span>` : ''}<span class="chev">${isOpen ? '▾' : '▸'}</span></span>
            </button>
            ${isOpen && html`<div class="nav">${items.map(([k, l]) => link(k, l))}</div>`}
          </div>`;
        })}`;
}

function Shell({ ctx, onLogout }) {
  const hash = useHash();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const visible = NAV.map(([key, g, icon, items]) => [key, g, icon, items.filter(([, , perm]) => !perm || ctx.can(perm))]).filter(([, , , items]) => items.length);
  const first = visible[0]?.[3][0]?.[0] ?? 'account';
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
      <${NavMenu} groups=${visible} route=${route} counts=${counts} />
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
