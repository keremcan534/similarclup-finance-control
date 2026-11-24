-- Owners, 24 Nov 2026: 1.000 jeton = 220 TL, 1 USD = 50,62 TL. From the day this reaches the server (the same day the
-- app's packs move to 220 TL per 1.000 coins and Play Console's prices are set to them) the book values coins at
-- 0,22 TRY (komisyon matrahı, "Gelir karşılığı") and converts USD at 50,62. Earlier rows keep the values of their own
-- dates. A new database (no currencies yet) skips this: Panel ayarları › Döviz kurları / Jeton-elmas değeri add them.
INSERT INTO exchange_rates (base, quote, rate, valid_from, source)
  SELECT 'USD', 'TRY', '50.62', date('now'), 'Yönetim (24 Kasım 2026)'
  WHERE EXISTS (SELECT 1 FROM currencies WHERE code = 'USD') AND EXISTS (SELECT 1 FROM currencies WHERE code = 'TRY');
INSERT INTO unit_valuations (unit, currency, value_per_unit, purpose, valid_from, note)
  SELECT 'COIN', 'TRY', '0.22', 'revenue', date('now'), '1.000 jeton = 220 TL (Yönetim, 24 Kasım 2026)'
  WHERE EXISTS (SELECT 1 FROM currencies WHERE code = 'COIN') AND EXISTS (SELECT 1 FROM currencies WHERE code = 'TRY');
