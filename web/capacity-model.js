// Sunucu kapasitesi: how full the app's one machine gets with a given crowd, how much traffic goes out in a month and
// what Oracle bills for it. The numbers come from the app's load test (its docs/YUK_TESTI.md, on one core): a voice
// room costs a little per person connected and a little per audio stream the server forwards (each listener gets
// each speaker), the app a little per request, and traffic is about 25 kbit/s per stream. Oracle's prices are its
// list prices of November 2026 (its docs/SUNUCU.md › Oracle hesabı ve maliyet). Plain functions, no browser:
// tests/capacity.test.ts checks them against the load test's rows.

/** Load per unit, in % of one core. */
export const LOAD = {
  base: 8, // the machine at rest: database, API, LiveKit, panel
  perVoice: 0.07, // a person connected to a voice room
  perStream: 0.035, // an audio stream forwarded (one speaker to one listener)
  perRps: 0.33, // one app request a second
};
/** A typical person in the app (in voice or not) asks the server this often, requests a second. */
export const RPS_PER_USER = 2.5 / 60;
/** Audio out per forwarded stream, Mbit/s. */
export const MBPS_PER_STREAM = 0.025;
/** Memory per core on Oracle's ARM machines as the app's runs (GB). */
export const GB_PER_CORE = 6;
/** Oracle, November 2026 (USD). */
export const ORACLE = {
  freeAccount: { cores: 2, memGb: 12 },
  paygFree: { ocpuHours: 3000, gbHours: 18000 },
  ocpuHour: 0.01,
  gbHour: 0.0015,
  freeEgressTb: 10,
  egressPerGb: 0.0085,
  hoursPerMonth: 730,
};
/** Above this the machine is near its limit; above `bad` voices break up and the app slows down (% of the machine). */
export const LIMITS = { ok: 60, bad: 85 };

const n = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);

/**
 * One crowd on one machine.
 *   voice       people in voice rooms at the same time
 *   speakers    people talking at once in a room (mics on), on average
 *   app         other people in the app at the same time (not in voice)
 *   busyHours   hours a day the crowd is that big (the rest of the day a sixth of it)
 *   cores       the machine's cores; memory is GB_PER_CORE each
 *   account     'free' (Oracle Always Free) or 'payg'
 */
export function simulate(input) {
  const voice = Math.max(0, n(input.voice));
  const speakers = Math.max(0, n(input.speakers, 2));
  const app = Math.max(0, n(input.app));
  const busyHours = Math.min(24, Math.max(0, n(input.busyHours, 6)));
  const cores = Math.max(1, n(input.cores, 1));
  const account = input.account === 'payg' ? 'payg' : 'free';

  const streams = voice * speakers;
  const rps = (voice + app) * RPS_PER_USER;
  const coreLoad = LOAD.base + voice * LOAD.perVoice + streams * LOAD.perStream + rps * LOAD.perRps;
  const cpu = coreLoad / cores;
  const status = cpu <= LIMITS.ok ? 'ok' : cpu <= LIMITS.bad ? 'tight' : 'bad';
  // The most people in voice this machine keeps under the limit, with the same talkers and app crowd.
  const perVoice = LOAD.perVoice + speakers * LOAD.perStream + RPS_PER_USER * LOAD.perRps;
  const room = (LIMITS.bad * cores - LOAD.base - app * RPS_PER_USER * LOAD.perRps) / perVoice;
  const maxVoice = Math.max(0, Math.floor(room));

  const peakMbps = streams * MBPS_PER_STREAM;
  const dayMbit = (peakMbps * busyHours + (peakMbps / 6) * (24 - busyHours)) * 3600;
  const monthTb = (dayMbit * 30) / 8 / 1e6;

  const memGb = cores * GB_PER_CORE;
  const fitsFree = cores <= ORACLE.freeAccount.cores && memGb <= ORACLE.freeAccount.memGb;
  const h = ORACLE.hoursPerMonth;
  const computeUsd =
    account === 'free' ? 0 : Math.max(0, cores * h - ORACLE.paygFree.ocpuHours) * ORACLE.ocpuHour + Math.max(0, memGb * h - ORACLE.paygFree.gbHours) * ORACLE.gbHour;
  const egressUsd = Math.max(0, monthTb - ORACLE.freeEgressTb) * 1000 * ORACLE.egressPerGb;

  return {
    streams,
    cpu: Math.round(cpu * 10) / 10,
    status,
    maxVoice,
    peakMbps: Math.round(peakMbps * 10) / 10,
    monthTb: Math.round(monthTb * 100) / 100,
    freeEgressLeftTb: Math.round(Math.max(0, ORACLE.freeEgressTb - monthTb) * 100) / 100,
    memGb,
    // A free account can't run this machine at all: Oracle's free share there is 2 cores / 12 GB.
    needsPayg: account === 'free' && !fitsFree,
    computeUsd: Math.round(computeUsd * 100) / 100,
    egressUsd: Math.round(egressUsd * 100) / 100,
    totalUsd: Math.round((computeUsd + egressUsd) * 100) / 100,
  };
}

/** The model's guess for what the machine is doing now (the panel shows it beside the measured %). */
export const modelNow = (now, cores) => (now ? simulate({ voice: now.voice, speakers: now.voice > 0 ? now.speakers / Math.max(1, now.rooms) : 0, app: 0, cores }).cpu : null);
