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
- Kullanıcılar zaten varken `FC_ADMIN_EMAIL` / `FC_ADMIN_PASSWORD` ile adı geçen giriş henüz yoksa, açılışta **bir kez**
  süper yönetici olarak eklenir. Giriş adı e-posta olmak zorunda değildir (ör. `admin`). Var olan bir hesaba hiç
  dokunulmaz: Hesabım'dan değiştirilen parola sonraki açılışlarda da geçerli kalır. Ortamdaki parolaya 10 karakter
  kuralı uygulanmaz (sunucunun sahibinin seçimi); panelden konan her parola en az 10 karakterdir.

İlk girişten sonra parolaları **Hesabım** ekranından değiştirin ve dosyayı silin.

Demo veritabanında üstte "DEMO VERİSİ" şeridi görünür. Demodaki tüm oranlar ve tutarlar **örnektir**: mağaza kesintisi, KDV ve sözleşme şartları gerçek değildir.

```bash
npm test          # 28 test: para/formül, komisyon motoru, hakediş, Lucky, HTTP/yetki/yedek
npm run typecheck
npm run backup    # tutarlı anlık yedek + bütünlük ve denetim zinciri doğrulaması
npm run restore -- data/backups/finance-....db   # sunucu durdurulmuşken
```

## Ekranlar

Menü konulara göre gruplu: Ana sayfa, Kullanıcılar ve güvenlik, Hediye ve mağaza, Duyuru ve etkinlik, Ajanslar, Para, Rapor ve maliyet, Ayarlar. Başlıklar açılıp kapanır (bu bilgisayarda hatırlanır), açık sayfanın konusu hep açıktır. En üstteki arama kutusu (Ctrl+K ya da /) her sayfayı adıyla ve ilgili kelimelerle bulur (ör. "ban" → Yaptırımlar, "sikayet" → Şikâyetler); Enter ilk sonucu açar.

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
| Şanslı hediye maliyeti (Lucky Gift) | Sürümlü olasılık tablosu (toplam tam 1 olmalı), maksimum ödül, günlük, kişi başı ve bütçe limitleri.<br>Teorik ve gerçekleşen geri ödeme, çarpan dağılımı, sapma (z) değerleri ve rezerv uyarısı. Her sonuç rastgele değeri ve tablo sürümüyle saklanır. |
| Genel giderler | Kategori, tedarikçi, sabit/değişken, vergi, tahakkuk ve vade bilgisiyle girilir. Tekrarlanan giderler (aylık, yıllık, N günde bir) desteklenir; ödeme ve iptal de buradadır. |
| Raporlar | Gelir tablosu, nakit akışı, ajans katkısı, BD ve yayıncı raporları, birim ekonomi (kullanıcı başı, ARPPU, saatlik ses/video maliyeti), oyun ve hediye raporları. Raporlar CSV olarak indirilebilir. |
| Nakit ve bütçe | Banka hesapları, bakiye girişleri, bütçe ve kâr hedefleri. |
| Büyüme simülasyonu | 100, 500, 1.000, 5.000 ve 10.000 kullanıcılık senaryolar ile özel senaryo. Gelir, gider, net sonuç, nakit ihtiyacı, başa baş gelir ve oranı ile marjinal maliyet hesaplanır. Sonuçlar tahmin olarak işaretlenir. |
| Uyarılar | 16 eşik türü vardır; önem derecesi, ilgili kayıt ve önerilen aksiyonla gösterilir. Kontroller saatte bir ve elle çalıştırılabilir. |
| Entegrasyonlar | API anahtarı üretme ve yenileme (anahtar yalnız bir kez gösterilir), içe aktarma geçmişi ve satır bazında hatalar. |
| Panel kullanıcıları ve rolleri | 6 hazır rol (Moderatör dahil) ve yeni rol tanımlama. Yetkiler tek tek seçilebilir; ajans kapsamlı roller yalnız kendi ajansını görür. |
| Denetim kaydı | Tüm kritik değişiklikler önce/sonra değerleriyle tutulur. Kayıtlar hash zinciriyle bağlıdır ve zincir doğrulanabilir. |
| Panel ayarları | Raporlama para birimi, çift onay, döviz kurları, jeton/elmas değerleri, vergi parametreleri, finansal dönem kapatma ve yedek alma. |
| Uygulama › Hediyeler | Similar Club uygulamasının hediyeleri: ekleme, düzenleme (ad, fiyat, raf, VIP, emoji), raftan kaldırma, silme, sıralama; uygulamanın kendi hediyelerinin de her alanını değiştirme ve **Orijinale dön**; ikon, hazır saydam video, WebM/MOV ya da SVGA yükleme (uygulamanın sunucusu çevirir) ya da her dosya için kendi sitenizdeki bağlantıyı yapıştırma (uygulamanın sunucusu bir kez indirir, aynı denetimden geçirir; "Bağlantıdan yeniden çek" ile yenilenir) ve önizleme. Uygulama güncellemesi olmadan herkesin hediye panelinde görünür. Ayrıntı: [Similar Club'ı yönetme](#similar-clubı-yönetme). |
| Uygulama › Emojiler | Emoji panelinin çıkartma paketleri: uygulamanın kendi paketleri (ad, fiyat, VIP, açık/kapalı, sıra) ve çıkartmaları (ad, emoji, resim, paket, açık/kapalı, sıra) değişir ve orijinaline döner; yeni paket ve çıkartma eklenir (saydam PNG/WebP ya da Lottie animasyonu, bilgisayardan ya da bağlantıdan). Uygulama güncellemesi olmadan telefonlara gider. |
| Uygulama › Mağaza | Çerçeveler, giriş efektleri, sohbet balonları, ses dalgaları ve koltuk renkleri: uygulamanın kendilerinin adı, fiyatı, süresi, VIP seviyesi, satışta olup olmadığı ve sırası değişir, orijinaline döner. Yeni çerçeve (durağan saydam kare PNG/WebP; fotoğraf alanı resmin saydam ortasından ölçülür, önizlemeyle ayarlanır; isteğe bağlı hareketli hali: hareketli WebP, yeni APK oynatır) ve **Toplu çerçeve ekle** (tasarımcının klasörü: her çerçevenin durağan PNG'si ve hareketli WebP'si adından eşleştirilir, PNG'si olmayanın durağan resmi WebP'nin ilk karesinden yapılır, adlar dosya adından yapılır, fiyat/süre/VIP hepsine birden; GIF ve SVGA kullanılmaz). Fotoğrafın yeri halkanın iç kenarına oturtulan daireyle ölçülür; önizlemede fareyle sürüklenip noktasından ya da tekerlekle büyütülerek elle de ayarlanır ve yeni giriş efekti (hazır yığılmış MP4 ya da uygulamanın sunucusunun çevirdiği WebM, ProRes .mov, SVGA) eklenir. Giriş efektinin isim plakası: odaya girenin adının yazılacağı yer (önizlemede sürüklenir, köşesinden büyütülür), genişlik, yazı boyu, renk; adın yazılıp yazılmayacağı, büyük harf, harf aralığı, gölge ya da parlama, kontur, arkasında bant, videonun kaçıncı saniyesinde görünüp kaybolacağı ve nasıl belireceği; örnek adla, oynat / durdur / baştan / döngü ve zaman çubuğuyla önizleme. Giriş efektinin mağazadaki ikonu (PNG/WebP). Yeni sohbet balonu: iki renk ve yazı rengi, ya da köşeleri bozulmadan uzayan bir resim (köşeler kaydırıcıyla, kısa ve uzun mesajla önizleme). Yeni ses dalgası: beş stilden biri ve renkleri, Parıltı'da dönen şekil için resim, konuşan yüzle önizleme. **Koltuk renkleri**: odadaki boş mikrofonların rengi; oda sahibi odası için alır. Her rengin adı, rengi (renk seçici ve hazır yumuşak tonlar; boş ve kilitli koltuk önizlemesi, telefondaki gibi: minder boyanır, altın kalır), fiyatı ve süresi (0: süresiz; süre bitince oda varsayılan renge döner) buradan; yeni renk eklenir. Varsayılan renk (Gümüş) her odanın ücretsiz rengidir: adı ve rengi değişir, fiyatı ve süresi olmaz, satıştan kalkmaz. Kartta rengin kaç odada olduğu görünür; bir odada olan renk silinmez. Sahibi olan eşya silinmez, satıştan kaldırılır. Telefonlar mağazayı yeni APK'da buradan gösterir. |
| Uygulama › Seviyeler ve VIP | VIP, Rütbe, Cömertlik, Yankı ve Abonelik: seviye puanları ve adları (Cömertlik ve Yankı için Lv.0–50, eğriyle doldurma yardımıyla), Rütbe kademelerinin adı, fiyatı ve günü, seviye grupları, hangi hakkın hangi seviyede açıldığı (hazır olanlar; "henüz yapılmadı" olanlar görünür ama açılmaz), hareket etmeyenin seviye düşmesi (VIP, Cömertlik, Yankı; başlangıçta kapalı) ve Abonelik paketlerinin uygulamada görünüşü. Kaydetmeden önce kaç kişinin yükseleceği ve düşeceği gösterilir; biri düşecekse onay ister. Seviye düşüşleri listesi. Sunucunun denetimleri hemen, telefonlar bir dakika içinde yeni ayarı izler. |
| Uygulama › Seviye ödülleri | VIP, Cömertlik ya da Yankı'da bir seviyeye gelenin Çantam'ına düşen eşya (çerçeve, giriş efekti, binek, sohbet balonu, ses dalgası), istenirse kendi gün sayısıyla. Seviyeyi önceden geçmiş olanlar da alır; herkes bir kez. Kaç kişiye verildiği görünür; kaldırılan ödül yeni kimseye verilmez, verilenler çantada kalır. |
| Uygulama › Para çekme | Yayıncıların elmas → para talepleri: hesap bilgisi, tutar; bankadan gönderildikten sonra "Ödendi" işareti ya da nedenli ret (elmaslar geri döner). Para bu panelden gönderilmez. |
| Uygulama › Ajans ödemeleri | Ajans komisyon talepleri: onay, dekont numarasıyla "Ödendi", ret, iptal. |
| Uygulama › İadeler ve cüzdan | Mağaza alımlarını arama ve iade etme (harcanmamış jeton ve kilitli elmas geri alınır), Google Play iadelerini okuma, bir hesabın cüzdan dökümü. |
| Uygulama › Şanslı hediye ayarı | Uygulamadaki Şanslı paketlerin fiyatı, olasılık tablosu (%100), günlük ödül limiti, duyuru çarpanı; bugünkü ve toplam gönderim, geri ödeme, son gönderimler. |
| Uygulama › Canlı ayarlar | Kur, jeton kampanyası, gizli hediye ve paketler, fiyatlar, sınırlar, acil durum anahtarları: önizleme, nedenle kayıt, geçmiş ve geri alma. |
| Uygulama › Oyun Salonu ve durum | Oyun Salonu'nun kasası, jackpot'ları ve oyun başına dönem raporu; uygulama sunucusunun uyarıları ve bu panele veri gönderimi. |
| Uygulama › Kullanıcılar | Uygulamanın hesaplarını ad, kullanıcı adı, kimlik, e-posta ya da oda ID'siyle arama; askıya alma (1–30 gün ya da süresiz, nedenle) ve kaldırma, oda seviyesi, davet ödülünü geri alma, hesap silme, deneme hesaplarını silme. |
| Uygulama › Şikâyetler | Kişi, oda, mesaj, an, yorum ve aile şikâyetleri: sorun yok, işlem yapıldı, askıya alma, an/yorumu kaldırma; şikâyet edilen odanın süslemesi ve kapağı (kaldırma). |
| Uygulama › Destek | Destek talepleri (bekleyen, yanıtlanan, kapalı): yazışma, fotoğraflar, yanıt (kişiye "Destek" adıyla), kapatma, yeniden açma. |
| Uygulama › Duyurular | Similar Ekibi duyuruları: herkese ya da tek kişiye, görsel, uygulama içi bağlantı, odalarda banner (1–30 gün); kaldırma. |
| Uygulama › Etkinlikler | Etkinlik başvurularını onaylama ya da gerekçeyle reddetme, yayındaki etkinliği kaldırma, etkinlik türleri, dönem raporu (7/30/90 gün). |
| Uygulama › Ajans merkezi | Uygulamanın ajans ağı, merkezin gözünden: özet, ağaç (oran, kademe, 30 günlük hacim ve kazanç, performans puanı), yeni ajans, başvuruları onaylama ya da reddetme, askıya alma, yeniden açma, kapatma, oran düzeltme, kademe, üst ajans değişikliği, yayıncıyı ajansa bağlama ya da çıkarma, geçiş komisyonu, transferlere merkez onayı, performans değerlendirmesi (deneme dahil), komisyon raporu, BD raporu, simülasyon ve merkezin denetim kaydı. Ayrı yetkiyle **komisyon defteri ve ağ kuralları**: bekleyen komisyonları hesaplama, elle gelir, ters kayıt, düzeltme, dönem kapatma, ağ kuralları (havuz sınırı, kademeler, ödeme ve transfer kuralları…). |
| Uygulama › Yaptırımlar | Uygulamanın yaptırımları: kişiyi arama ve kaydı; susturma, süreli ve ömür boyu ban, cihaz banı, kaldırma, kanıt; cihaz riski; onay bekleyenler (ömür boyu ve cihaz banını öneren değil başka bir yetkili onaylar); itirazlar; ceza kademeleri; kimin neyi yapabileceği. `app.sanctions` uygulamadaki moderatör kadar yetki verir (ömür boyu ban yalnız öneri olur), `app.sanctions_full` tam yetki. |
| Uygulama › Ajans personeli | Ajans merkezinin personeli ve rolleri, ajansın BD sorumlusu, operasyon puanı, ihlal kaydı, itirazlar ve arka plan işlerini elle çalıştırma. |
| Uygulama › Mağaza eşyaları | Bir kişinin mağaza eşyaları: eşya verme ve geri alma, iadeden sonra elinde kalan eşyalar. Her eşyanın nereden geldiği (satın alma, yönetim, etkinlik, görev ya da seviye ödülü; ödülde hangisi: "VIP 5", etkinliğin adı). |
| Uygulama › Jeton Noktası | Jeton Noktası hesaplarını açma ve kapama, dekont numarasıyla toptan jeton satışı. |

**Sıralama** (Hediyeler, Emojiler, Mağaza): telefonlar listeyi panelin sırasıyla gösterir. Satır, kart ya da çıkartma fareyle tutulup başka birinin yerine bırakılır; oklar bir adım kaydırır; **Sırala** düğmeleri bir rafı, paket listesini ya da mağazanın bir türünü tek seferde dizer (ucuzdan pahalıya, pahalıdan ucuza, en çok gönderilen / alınan, VIP seviyesi, ada göre; önce sorar). Hediyelerde sıra raf içindedir (Tümü'nde her raf kendi içinde dizilir); başka rafın satırına bırakmak bir şey yapmaz.

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

## Similar Club'ı yönetme

**Uygulama** bölümündeki sayfalar Similar Club'ın kendi yönetim API'sini bu panelden kullanır (`server/app-admin.ts`).
Tarayıcı yalnız bu sunucuyla konuşur; bu sunucu uygulamanın API'sini **aynı makinede** bir anahtarla çağırır ve
isteği yapan panel kullanıcısını (`id`, e-posta, ad, rol) bildirir. Uygulama her işlemi kendi denetim kaydına bu
kişinin adıyla yazar; panel de kendi denetim kaydına yazar.

| Ayar | Anlamı |
| --- | --- |
| `FC_APP_API_URL` | Uygulamanın API'si (sunucuda `http://127.0.0.1:7890`). Boşsa Uygulama sayfaları "bağlantı ayarlı değil" der. |
| `FC_APP_API_KEY` | Uygulamanın `PANEL_API_KEY`'i (en az 32 karakter). Yalnız sunucuda durur; tarayıcıya hiç gitmez. |

Sunucuda ikisi de kurulumla gelir (`cix` deposu: `server/infra/compose.yaml`, `.github/workflows/server.yml`).
Uygulama da anahtarı yalnız kendi makinesinden gelen ve kendi listesindeki uçlar için kabul eder.

Hangi panel kullanıcısının hangi sayfayı kullanacağını bu panelin rolleri belirler:

| Yetki | Sayfa | Hazır rollerde |
| --- | --- | --- |
| `app.gifts` | Uygulama › Hediyeler | Süper yönetici, finans yöneticisi, operasyon yöneticisi |
| `app.emojis` | Uygulama › Emojiler | Süper yönetici, finans yöneticisi, operasyon yöneticisi |
| `app.shop` | Uygulama › Mağaza | Süper yönetici, finans yöneticisi, operasyon yöneticisi |
| `app.levels` | Uygulama › Seviyeler ve VIP ve Seviye ödülleri (kritik: Rütbe fiyatı, seviye düşmesi) | Süper yönetici, finans yöneticisi |
| `app.withdrawals` | Uygulama › Para çekme | Süper yönetici, finans yöneticisi |
| `app.payouts` | Uygulama › Ajans ödemeleri | Süper yönetici, finans yöneticisi |
| `app.refunds` | Uygulama › İadeler ve cüzdan | Süper yönetici, finans yöneticisi |
| `app.lucky` | Uygulama › Şanslı hediye ayarı | Süper yönetici, finans yöneticisi |
| `app.settings` | Uygulama › Canlı ayarlar | Süper yönetici, finans yöneticisi |
| `app.reports` | Uygulama › Oyun Salonu ve durum | Süper yönetici, finans yöneticisi, operasyon yöneticisi |
| `app.users` | Uygulama › Kullanıcılar | Süper yönetici, operasyon yöneticisi |
| `app.complaints` | Uygulama › Şikâyetler | Süper yönetici, operasyon yöneticisi |
| `app.support` | Uygulama › Destek | Süper yönetici, operasyon yöneticisi |
| `app.notices` | Uygulama › Duyurular | Süper yönetici, operasyon yöneticisi |
| `app.events` | Uygulama › Etkinlikler | Süper yönetici, operasyon yöneticisi |
| `app.agencies` | Uygulama › Ajans merkezi | Süper yönetici, finans yöneticisi |
| `app.agency_ledger` | Uygulama › Ajans merkezi › Defter ve kurallar (kritik) | Süper yönetici, finans yöneticisi |
| `app.sanctions` | Uygulama › Yaptırımlar (moderatör yetkisi) | Süper yönetici, operasyon yöneticisi, moderatör |
| `app.sanctions_full` | Uygulama › Yaptırımlar (tam yetki: onay, ceza kademeleri, yaptırım yetkileri, cihaz riski) | Süper yönetici, operasyon yöneticisi |
| `app.agency_staff` | Uygulama › Ajans personeli | Süper yönetici, operasyon yöneticisi |
| `app.economy` | Uygulama › Mağaza eşyaları | Süper yönetici, operasyon yöneticisi |
| `app.jeton` | Uygulama › Jeton Noktası | Süper yönetici, finans yöneticisi |

Panelden yapılan her işlem uygulamada tek bir hesaptan (Finance Control) yapılmış sayılır; kimin yaptığı iki tarafın
denetim kaydında da yazar. Bunun bir sonucu: ajans ödemelerinde **iki kişili onay** açıksa, panelden onaylanan bir
ödemenin "Ödendi" işaretini uygulamadaki Yönetim'den başka bir yönetici koymalıdır (uygulama onaylayanla ödeyeni
aynı hesap sayar). Kendi talebine karar verememe gibi kurallar uygulamanın kendisinde kalır.

Uygulamada kalanlar: **Yaptırımlar** (kanıt, onay, itiraz, cihaz engeli, personelin yaptırım yetkileri), ajans
merkezinin **personel rolleri ve yetkileri**, BD atama, operasyon puanı, ihlal ve itirazlar, arka plan işleri,
Yönetim'in **Özet** sekmesi ve odanın içinden yapılan işler.

Dosyalar (ikon, video, SVGA) tarayıcıdan bu sunucu üzerinden uygulamanın deposuna akar, hiçbir yerde bütün tutulmaz (video kaynağı en çok 500 MB, SVGA 100 MB). Depodaki
dosyalar da önizleme için bu sunucudan okunur (`/api/app/media/f/…`, `/api/app/fx/…`).

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
