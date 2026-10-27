# Similarclup Finance Control

Similar Club'ın gelirlerini, komisyonlarını, hakedişlerini, servis maliyetlerini, oyun ve Lucky Gift ekonomisini ve nakit yükümlülüklerini tek yerde hesaplayan **bağımsız** web paneli.

- **Ayrı çalışır.** Mobil uygulamanın (`cix`) koduna dokunmaz. Kendi veritabanı, sunucusu ve kullanıcıları vardır.
- **Bağlantıya hazırdır.** Similar Club'tan veriyi API anahtarlı REST uç noktası, CSV veya manuel girişle alır.
- **Kurallar veri olarak tutulur, koda gömülmez.** Komisyon oranları, matrahlar, kademeler, maaşlar, kanal kesintileri, servis tarifeleri, Lucky olasılıkları ve eşikler panelden yönetilir. Her değişiklik yeni sürüm olarak eklenir.
- **Hesaplar deterministiktir.** Para hesabında hiçbir yerde kayan noktalı sayı kullanılmaz. Her sonucun hangi kural sürümüyle nasıl bulunduğu (hesap izi) saklanır.

> Bu, gereksinim şartnamesinin çalışan ilk sürümüdür. Gerçek kullanımdan önce iş kuralları, muhasebe yaklaşımı ve mevzuat ayrıca doğrulanmalıdır. Bkz. [Eksikler ve varsayımlar](#eksikler-ve-varsayımlar).

## Hızlı başlangıç

Gereken: **Node.js 24+** (yerleşik `node:sqlite` kullanılır; ayrı bir veritabanı sunucusu gerekmez).

```bash
npm install
npm run seed      # isteğe bağlı: DEMO verisi (boş veritabanına)
npm start         # http://127.0.0.1:4300
```

Giriş e-postaları ve parolaları **rastgele üretilir** ve `data/giris-bilgileri.txt` dosyasına yazılır. Bu dosya git'e eklenmez ve konsola parola yazılmaz.

- **Demo ile başladıysanız** dosyada beş kullanıcı bulunur: süper yönetici, finans yöneticisi, operasyon yöneticisi, ajans yöneticisi (yalnız Yıldız Ajans) ve salt okunur kullanıcı.
- **Demo yüklemeden başladıysanız** ilk açılışta yalnız süper yönetici oluşturulur. E-posta ve parolayı önceden belirlemek isterseniz `.env` dosyasında `FC_ADMIN_EMAIL` / `FC_ADMIN_PASSWORD` değişkenlerini kullanın.

İlk girişten sonra parolaları **Hesabım** ekranından değiştirin ve dosyayı silin.

Demo veritabanında üstte "DEMO VERİSİ" şeridi görünür. Demodaki tüm oranlar ve tutarlar **örnektir**: mağaza kesintisi, KDV ve sözleşme şartları gerçek değildir.

```bash
npm test          # 28 test: para/formül, komisyon motoru, hakediş, Lucky, HTTP/yetki/yedek
npm run typecheck
npm run backup    # tutarlı anlık yedek + bütünlük ve denetim zinciri doğrulaması
npm run restore -- data/backups/finance-....db   # sunucu durdurulmuşken
```

## Ekranlar

| Bölüm | Ne yapar |
| --- | --- |
| Ana panel | 14 gösterge kartı vardır: brüt satış, tahsilat, net gelir, ödenen ve tahakkuk eden gider, bekleyen ajans/BD/yayıncı hakedişleri, servis gideri, işletme sonucu, nakit, yükümlülük ve ay sonu tahmini.<br>Her kart, hesaplandığı kayıtlara tıklanarak açılır. Panelde ayrıca günlük seri, gider dağılımı, veri kalitesi paneli ve canlı göstergeler bulunur. Bağlı olmayan kaynaklar boş bırakılır. |
| İşlem defteri | Para ve jeton hareketleri listelenir. Her işlemin komisyon dağılımı hesap iziyle birlikte görülür. Ters kayıt ve iade, manuel olay girişi, CSV içe aktarma ve kullanıcı bakiyeleri buradadır. |
| Ödeme kanalları | Kanal başına sürümlü kesinti girilir: yüzde, işlem başı sabit ücret, iade ücreti, ters ibraz maliyeti ve tahsilatın hesaba geçme süresi. |
| Komisyon kuralları | Kural düzenleyici; yüzde, sabit, birim başı, kademeli/dilimli ve formül yöntemleri; min/maks sınırı; koşul ve filtreler; aşama (paralel/ardışık); iade davranışı.<br>Ayrıca doğrulama, çakışma uyarısı, örnek işlemle deneme, sürüm geçmişi, yürürlüğe alma (çift onaylı) ve hesaplama sorunlarının yeniden hesaplanması. |
| Ajans / BD / Yayıncı | Profil, sözleşmeler (maaş, minimum garanti, ödeme takvimi) ve dönem finansı. Ajans ekranında uygun gelir, yayıncı ve BD payları, ödenen, bekleyen ve itiraz edilen tutarlar ile şirkete net katkı gösterilir. |
| Hakedişler | Dönem hesaplama → onay (hesaplayan kişi onaylayamaz) → ödeme kaydı. İtiraz, iptal, düzeltme/bonus/kesinti kayıtları ve devreden negatif bakiye de buradan yönetilir. |
| Sunucu ve servisler | Sağlayıcı, tarife (sabit ücret, kota, birim fiyat, kademe, vergi), kullanım kaydı, fatura ve mutabakat. Kullanımı olmayan servis "veri yok" görünür, 0 sayılmaz. |
| Oyun, hediye, PK | Lisans, üretim, aylık ve kullanım başı maliyetler ayrı izlenir. PK ödül maliyeti ve kalem bazında kârlılık gösterilir. |
| Lucky Gift | Sürümlü olasılık tablosu (toplam tam 1 olmalı), maksimum ödül, günlük, kişi başı ve bütçe limitleri.<br>Teorik ve gerçekleşen geri ödeme, çarpan dağılımı, sapma (z) değerleri ve rezerv uyarısı. Her sonuç rastgele değeri ve tablo sürümüyle saklanır. |
| Genel giderler | Kategori, tedarikçi, sabit/değişken, vergi, tahakkuk ve vade bilgisiyle girilir. Tekrarlanan giderler (aylık, yıllık, N günde bir) desteklenir; ödeme ve iptal de buradadır. |
| Raporlar | Gelir tablosu, nakit akışı, ajans katkısı, BD ve yayıncı raporları, birim ekonomi (kullanıcı başı, ARPPU, saatlik ses/video maliyeti), oyun ve hediye raporları. Raporlar CSV olarak indirilebilir. |
| Nakit ve bütçe | Banka hesapları, bakiye girişleri, bütçe ve kâr hedefleri. |
| Büyüme simülasyonu | 100, 500, 1.000, 5.000 ve 10.000 kullanıcılık senaryolar ile özel senaryo. Gelir, gider, net sonuç, nakit ihtiyacı, başa baş gelir ve oranı ile marjinal maliyet hesaplanır. Sonuçlar tahmin olarak işaretlenir. |
| Uyarılar | 16 eşik türü vardır; önem derecesi, ilgili kayıt ve önerilen aksiyonla gösterilir. Kontroller saatte bir ve elle çalıştırılabilir. |
| Entegrasyonlar | API anahtarı üretme ve yenileme (anahtar yalnız bir kez gösterilir), içe aktarma geçmişi ve satır bazında hatalar. |
| Kullanıcılar ve roller | 5 hazır rol ve yeni rol tanımlama. Yetkiler tek tek seçilebilir; ajans kapsamlı roller yalnız kendi ajansını görür. |
| Denetim kaydı | Tüm kritik değişiklikler önce/sonra değerleriyle tutulur. Kayıtlar hash zinciriyle bağlıdır ve zincir doğrulanabilir. |
| Ayarlar | Raporlama para birimi, çift onay, döviz kurları, jeton/elmas değerleri, vergi parametreleri, finansal dönem kapatma ve yedek alma. |

## Similar Club'tan veri alma

Similar Club sunucusu her finansal olayı **benzersiz bir anahtarla** gönderir:

```http
POST /api/ingest/events
X-Api-Key: fc_xxxxxxxx_...
Content-Type: application/json

{"events":[
  {"type":"purchase","idempotency_key":"order-123","occurred_at":"2026-10-01T10:00:00Z","user_ref":"u1","channel":"google","amount":"99.99","currency":"TRY","coins":1000},
  {"type":"gift","idempotency_key":"gift-555","sender_ref":"u1","publisher_ref":"u100","gift_ref":"ROSE","coins":100,"event_ref":"PK-42"},
  {"type":"refund","idempotency_key":"refund-1","original_key":"order-123","amount":"50.00"}
]}
```

**Olay türleri:**

| Tür | Anlamı |
| --- | --- |
| `purchase` | Jeton satın alma |
| `refund`, `chargeback` | Kısmi veya tam iade, ters ibraz |
| `gift` | Hediye gönderme |
| `call` | Sesli veya görüntülü arama (dakika ve jeton) |
| `game` | Oyun girişi ve sonucu |
| `lucky` | Lucky Gift sonucu (tabloya göre doğrulanır) |
| `bonus_grant`, `promotion`, `coin_spend` | Jeton verme ve harcama |
| `usage` | Servis kullanımı |
| `publisher` | Yayıncı ile ajans eşleştirmesi |

**Davranış:**

- **Tekrar gönderim güvenlidir.** Aynı anahtarla tekrar gelen olay `duplicate` döner ve yeni kayıt oluşturmaz. Aynı anahtar farklı içerikle gelirse olay reddedilir.
- **Hatalı olay diğerlerini durdurmaz.** Her olay için ayrı sonuç döner: `created`, `duplicate` veya `error`.
- **Bilinmeyen yayıncı id'si** "Eşleşmemiş" yayıncı olarak açılır ve uyarı üretir.
- **Kapalı döneme ait gecikmiş olaylar** ilk açık güne kaydedilir. Geçmiş dönem sonuçları değişmez.
- **Lucky sonucunu bu platform çeksin isterseniz:** `POST /api/ingest/lucky/draw` kullanın. Çekiliş CSPRNG ile yapılır, limitler uygulanır ve sonuç kaydedilir.

## Mimari

```
server/                Node.js (TypeScript, derleme yok), bağımlılıksız HTTP sunucusu
  lib/money.ts         Sabit noktalı ondalık (BigInt, 12 hane) + açık yuvarlama modları
  lib/formula.ts       Güvenli formül dili (eval yok, beyaz liste değişken/fonksiyon)
  domain/ledger.ts     Olay alımı, idempotency, kesinti/vergi/değerleme dondurma, ters kayıt
  domain/commission.ts Kural doğrulama, aşamalı hesaplama, iade ters kaydı, çakışma tespiti
  domain/statements.ts Hakediş: komisyon + dönemsel kurallar + maaş + garanti + düzeltme + devir
  domain/costs.ts      Tarife × kullanım, fatura mutabakatı, tekrarlanan giderler
  domain/lucky.ts      Olasılık tabloları, doğrulama, sunucu çekilişi, ekonomik analiz
  domain/reports.ts    Gelir tablosu, nakit, yükümlülük, birim ekonomi, kalem raporları
  domain/alerts.ts     Eşik kontrolleri
  domain/simulation.ts Senaryo ve başa baş
  domain/governance.ts Çift onay, kural yürürlüğü, dönem kapatma
  migrations/*.sql     Şema sürümleri (schema_migrations tablosu)
web/                   Preact + htm (derleme yok), sunucudan statik servis
tests/                 node:test
```

**Veritabanı:** SQLite, WAL modunda ve `synchronous=FULL` ayarıyla çalışır. Şema [server/migrations/001_init.sql](server/migrations/001_init.sql) dosyasındadır.

**Varlıklar:**

- Kimlik ve yetki: users, roles, sessions, audit_logs, approvals
- Para birimleri, kurlar ve vergi: currencies, exchange_rates, unit_valuations, tax_configurations
- Taraflar: agencies, business_developers, publishers, contracts
- Ödeme kanalları: payment_channels, channel_fee_versions
- Defter: financial_transactions, wallet_transactions
- Komisyon: commission_rules, commission_rule_versions, commission_allocations, calculation_issues
- Hakediş ve ödeme: payout_statements, statement_lines, payout_adjustments, payouts
- Servis maliyetleri: service_providers, cost_tariffs, service_usage_records, service_invoices, reconciliations
- Katalog ve PK: catalog_items, pk_events
- Lucky Gift: lucky_gift_configurations, lucky_gift_config_versions, lucky_gift_results
- Gider: expense_categories, expense_records
- Nakit, bütçe ve tahmin: cash_accounts, cash_snapshots, budgets, forecasts
- Uyarılar: alert_rules, alerts
- Entegrasyon ve dönem: integration_connections, import_batches, periods

Tek tablo ya da serbest metin finans kaydı yoktur.

**Teknoloji seçimi:** Ücretli servis ve harici veritabanı bağımlılığı yoktur; sunucu bağımlılıksızdır. Arayüzde yalnız `preact` ve `htm` kullanılır.

Veri büyüdüğünde PostgreSQL'e geçmek mümkündür. Bunun için `db.ts` ve SQL lehçesi uyarlanır; alan modeli değişmez.

## Hesaplama kuralları

**Tutarlar:**

- Para birimi başına tam sayı alt birimle saklanır (kuruş, cent, jeton).
- Ara hesaplar 12 ondalık haneyle yapılır.
- Her yuvarlama yer ve mod olarak açıktır. Kural başına seçilebilir; varsayılan "yarımda çifte"dir.

**Satın alma:**

- Vergi brüt tutarın içinden ayrılır: `brüt × p / (100 + p)`.
- Kanal kesintisi `brüt × yüzde + sabit ücret` olarak hesaplanır.
- Net tahsilat `brüt − vergi − kesinti` olarak bulunur.
- Kesinti tarifesi, vergi parametresi ve jeton değeri işlem tarihinde neyse o kullanılır ve satıra dondurulur. Sonradan yapılan değişiklik geçmiş satırları etkilemez.

**Komisyon:**

- İşlem tarihinde yürürlükte olan sürümler kullanılır.
- Aynı aşamadaki kurallar aynı matrahı görür (paralel). Sonraki aşamalar `remaining` değişkeniyle kalan tutar üzerinden çalışır (ardışık). `r_<kod>` değişkeni önceki bir kuralın sonucunu verir.
- Toplam, dağıtılabilir tutarı aşarsa o işleme **hiç pay yazılmaz**, sorun kaydı ve uyarı açılır. Kural düzeltilince "Yeniden hesapla" ile tamamlanır.

**İade:**

- Orijinal payların iade oranı kadarı, ayrı ters kayıtla geri alınır.
- Kümülatif geri alma orijinal tutarı geçemez.

**Hakediş:**

- Hakediş şu kalemlerden oluşur: dönem komisyonları (kural bazında, dönem sonu kuruyla), dönemsel kurallar (hedef, kademe, prim, kesinti), sözleşme maaşı (sözleşme dönemin ortasında başlarsa gün bazında oranlanır) ve minimum garanti tamamlaması.
- Bunlara dönem düzeltmeleri ve önceki dönemden devreden negatif bakiye eklenir.

**Gelir tablosu:**

- Her kaynak tek bir kalemde sayılır.
- Komisyonlar defterden alınır. Hakediş satırlarından yalnız komisyon dışı kalemler eklenir.
- Lucky ödül jetonu gider sayılmaz, yalnız bilgi olarak gösterilir. Ekonomik maliyet, harcandıklarında oluşan yayıncı payında görünür.

**Eksik veri:**

- Kur eksikse tutar toplama alınmaz ve raporda listelenir.
- Kullanım kaydı olmayan kullanım bazlı servis "veri yok" olarak gösterilir.

## Güvenlik ve bütünlük

**Değiştirilemez kayıtlar:**

- Defter, komisyon dağılımı, Lucky sonucu, ödeme ve düzeltme kayıtları ile denetim kaydı veritabanı tetikleyicileriyle korunur: `UPDATE` ve `DELETE` reddedilir.
- Taslak dışındaki kural ve Lucky sürümleri değiştirilemez.
- Onaylı hakediş satırları donar.

**Kimlik doğrulama ve oturum:**

- Parolalar scrypt ile saklanır. 5 hatalı denemede hesap 15 dakika kilitlenir.
- İsteğe bağlı TOTP (2FA) vardır.
- Oturum çerezi HttpOnly ve SameSite=Strict'tir. Gövde yalnız JSON kabul edilir.
- CSP ve diğer güvenlik başlıkları gönderilir.

**Yetki ve görev ayrılığı:**

- Kural yürürlüğü, dönem kapatma ve Lucky tablosu ikinci bir yetkilinin onayıyla uygulanır. Hesaplayan kişi hakedişi onaylayamaz.
- Ajans kullanıcıları yalnız kendi ajansını ve yayıncılarını görür; bu kısıt sunucuda uygulanır.

**API anahtarları ve dışa aktarma:**

- API anahtarları yalnız SHA-256 özeti olarak saklanır ve arayüzde açık gösterilmez.
- CSV dışa aktarımında formül enjeksiyonu engellenir.

**Ağ:** Sunucu varsayılan olarak yalnız `127.0.0.1` adresini dinler. Ağa açılacaksa önüne HTTPS ters vekil konmalı ve `FC_COOKIE_SECURE=1` yapılmalıdır.

## Kabul kriterleri

| # | Kriter | Durum |
| --- | --- | --- |
| 1–3 | Yeni komisyon türü, kod değiştirmeden oran/tutar, aynı işlemde çoklu kural | ✔ Kural düzenleyici, aşamalar (test: `engine.test.ts`) |
| 4 | Geçmiş işlemler eski sürümle | ✔ Her pay sürüm ve izle saklanır (test) |
| 5–6 | Ajans/BD/yayıncı hakedişi; maaş, garanti, prim | ✔ (test: `statements.test.ts`) |
| 7 | Servis maliyeti manuel/otomatik | ✔ Manuel, CSV ve API (`usage` olayı). Sağlayıcıların kendi API'lerinden otomatik çekme henüz yok. |
| 8–11 | Oyun/hediye/PK/Lucky ayrı; gelir–gider–tahakkuk–nakit ayrımı; kullanıcı ve servis başı maliyet; fatura mutabakatı | ✔ |
| 12 | Eksik veri, API hatası ve tahminin görünmesi | ✔ Veri kalitesi paneli, "tahmini/veri yok" etiketleri |
| 13 | Uyarılar | ✔ Panelde. E-posta gönderimi için SMTP henüz yok. |
| 14 | Geçmiş kayıtlar iz bırakmadan değiştirilemez | ✔ Tetikleyiciler ve hash zinciri (test) |
| 15 | Yetki ve finansal doğruluk testleri | ✔ 28 test |
| 16 | Çalışan veritabanı, motor ve raporlar | ✔ |

## Eksikler ve varsayımlar

- **Similar Club'ın henüz gerçek bir backend'i ve veritabanı yok.** Uygulama şu an sahte veriyle çalışan bir prototip. Bu platform veriyi doğrudan Similar Club veritabanından okumaz; Similar Club sunucusunun olayları `/api/ingest/events` adresine göndermesini bekler. Bağlantı kaydı hazırdır ("Similar Club uygulaması — bağlı değil"); backend yazılınca yalnız bu çağrılar eklenecek. Doğrudan veritabanı okuma da tercih edilirse, "database" türü bağlantı için bir okuyucu yazılması gerekir.
- **Sağlayıcı API'leri bağlı değil.** Agora, sunucu sağlayıcısı, SMS ve diğerleri için hangi sağlayıcının kullanılacağı belli olmadığından otomatik çekme yazılmadı. Kullanım manuel, CSV veya `usage` olayıyla girilir. Panelde bu durum "bağlı değil" olarak görünür.
- **Bildirim gönderimi yok.** E-posta ve SMS için SMTP veya sağlayıcı tanımlanmadı; uyarılar şimdilik yalnız panelde görünür.
- **Vergi hesabı basit.** Vergi tek oranlı ve "brüt içinde" modeliyle hesaplanır; muhasebe sunumu ve mevzuat uyumu ayrıca doğrulanmalıdır.
- **Uygulama tek sunucu için tasarlandı.** SQLite kullanır; çok sunuculu kurulum için PostgreSQL'e geçilmelidir.
- **Sözleşme koşulları açıklama alanında.** Ajans ve yayıncıya özel oranlar kural filtreleriyle (ajans ve yayıncı id'si) tanımlanır; sözleşmedeki "koşullar" alanı yalnız açıklama içindir.
