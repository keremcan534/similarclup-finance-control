// The book's days in Türkiye's time (owners, 24 Nov 2026: the app's week is Monday 00:00 to Sunday 23:59:59, Türkiye
// time): an event at 00:30 Türkiye time is booked on that day, not the day before (context.ts trDay, rates.ts bookingDate).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { trDay } from '../server/context.ts';

describe('Defterin günü Türkiye saatiyle', () => {
  test('Türkiye gece yarısında döner; düz tarih olduğu gibi kalır', () => {
    assert.equal(trDay('2026-11-29T20:59:59.000Z'), '2026-11-29', 'Pazar 23:59:59');
    assert.equal(trDay('2026-11-29T21:00:00.000Z'), '2026-11-30', 'Pazartesi 00:00');
    assert.equal(trDay('2026-11-23T21:30:00Z'), '2026-11-24', '00:30 Türkiye');
    assert.equal(trDay('2026-11-24'), '2026-11-24');
    assert.equal(trDay(Date.UTC(2026, 11, 31, 21, 0)), '2027-01-01', 'yılbaşı');
  });
});
