export const CONFIG = {
  buyWindow: { start: '14:30', end: '14:57' },
  sellWindow: { start: '09:30', end: '11:30' },

  maxPositions: 3,
  singleMaxPct: 0.3,
  totalMaxPct: 0.5,
  maxEvaluate: 80,
  maxTickChecks: 6,

  minChangePct: 3,
  maxChangePct: 5,
  minVolRatio: 1,
  minTurnoverPct: 5,
  maxTurnoverPct: 10,
  minMcapYi: 50,
  maxMcapYi: 200,

  initialCash: 200000,
  quoteBatchSize: 50,
  quoteBatchDelayMs: 120,
  concurrency: 4,
  pollIntervalSec: 60,

  requestTimeoutMs: 10000,
  klineHostCooldownMs: 120000,
  tickPageDelayMs: 100,
  tickMaxPages: 300,

  staleQuoteMinutes: 15,
  sellStaleMinutes: 10,
  vwapMismatchTolerance: 0.002,

  paths: {
    universe: 'scripts/overnight/universe.txt',
    state: 'data/state/overnight.json',
    lock: 'data/state/overnight.lock',
    calendarDir: 'data/state',
    logDir: 'data/logs',
  },
}
