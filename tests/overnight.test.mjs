import assert from 'node:assert/strict'
import test from 'node:test'
import { parseArgs } from '../scripts/overnight/args.mjs'
import {
  alignMinuteBars,
  applyTickVwap,
  buildVwapSeries,
  calcMA,
  checkAboveVwap,
  checkMaBullish,
  checkNewHighPullback,
  checkVolumeGrowth,
  classifyStrength,
  isRally,
  isRebound,
  tickVwapByMinute,
} from '../scripts/overnight/indicators.mjs'
import { classifyOpen, isWeekend, shanghaiNow } from '../scripts/overnight/market.mjs'
import {
  evaluateSellDecision,
  hardFilterQuote,
  isStOrDelisting,
  sizePositions,
} from '../scripts/overnight/strategy.mjs'
import {
  isMainBoard,
  normalizeCode,
  parseMinuteNode,
  parseQuoteText,
  parseTickText,
  toOutputCode,
} from '../scripts/overnight/tencent.mjs'
import { buildBuyOrder, buildSellOrder, charLength } from '../scripts/overnight/output.mjs'
import {
  applyBuy,
  applySell,
  defaultState,
  formatPositionStatus,
  positionStatus,
} from '../scripts/overnight/portfolio.mjs'

function quoteFields(overrides = {}) {
  const values = {
    1: '贵州茅台',
    3: '10.00',
    4: '9.60',
    5: '9.70',
    30: '20261023142958',
    31: '0.40',
    32: '4.17',
    33: '10.10',
    34: '9.65',
    35: '10.00/10000/10000000',
    36: '10000',
    37: '1000',
    38: '7.00',
    43: '4.69',
    44: '100.00',
    45: '100.00',
    46: '2.00',
    47: '10.56',
    48: '8.64',
    49: '1.50',
    51: '9.90',
    52: '20.00',
    ...overrides,
  }
  const fields = new Array(62).fill('')
  for (const [index, value] of Object.entries(values)) fields[Number(index)] = String(value)
  return fields
}

function quoteText(overrides = {}) {
  return `v_sh600519="${quoteFields(overrides).join('~')}";`
}

function minuteNode(rows) {
  return { data: { date: '20261023', data: rows } }
}

function sellQuote(overrides = {}) {
  return {
    code: 'sh600519',
    name: '贵州茅台',
    price: 10,
    open: 10,
    lastClose: 10,
    high: 10.2,
    low: 9.8,
    quoteDate: '2026-10-24',
    quoteClock: '09:35:00',
    isStale: false,
    isOneWordLimitDown: false,
    ...overrides,
  }
}

function sellMinutes({ close, vwap, hhmm = '0935' }) {
  return ['0931', '0932', '0933', '0934', hhmm].map((time) => ({
    hhmm: time,
    price: close,
    vwap,
  }))
}

test('CLI 参数解析不吞位置参数', () => {
  assert.deepEqual(parseArgs(['probe', '--ticks', 'sz000001']), {
    positional: ['probe', 'sz000001'],
    flags: { ticks: true },
  })
  assert.deepEqual(parseArgs(['buy', '--codes', 'sh600519,sz000001', '--dry-run']), {
    positional: ['buy'],
    flags: { codes: 'sh600519,sz000001', 'dry-run': true },
  })
  assert.deepEqual(parseArgs(['sell', '--poll', '30', '--once']), {
    positional: ['sell'],
    flags: { poll: '30', once: true },
  })
  assert.deepEqual(parseArgs(['refresh-universe', '--from', 'data/codes.txt']), {
    positional: ['refresh-universe'],
    flags: { from: 'data/codes.txt' },
  })
  assert.deepEqual(parseArgs(['buy', '--cash=200000', '--dry-run=false']), {
    positional: ['buy'],
    flags: { cash: '200000', 'dry-run': false },
  })
})

test('上海时间与周末判断', () => {
  const now = shanghaiNow(new Date('2026-10-23T06:30:00Z'))
  assert.equal(now.date, '2026-10-23')
  assert.equal(now.time.slice(0, 5), '14:30')
  assert.equal(now.hhmm, '1430')
  assert.equal(isWeekend('2026-10-23'), false)
  assert.equal(isWeekend('2026-10-24'), true)
})

test('模拟账户买卖与 T+1 状态', () => {
  const state = defaultState(1000000)
  applyBuy(
    state,
    [{ quote: { code: 'sh600519', name: '贵州茅台', price: 10 }, shares: 100, cost: 1000 }],
    { date: '2026-10-23' }
  )
  assert.equal(state.cash, 999000)
  assert.equal(state.positions.length, 1)
  applySell(state, state.positions[0], { price: 11, date: '2026-10-24', rule: 1 })
  assert.equal(state.cash, 1000100)
  assert.equal(state.positions.length, 0)
})

test('空仓与 T+1 仓位状态提示', () => {
  const empty = defaultState(200000)
  const emptyStatus = positionStatus(empty, '2026-10-24')
  assert.equal(emptyStatus.total, 0)
  assert.equal(emptyStatus.sellable.length, 0)
  assert.match(formatPositionStatus(emptyStatus), /当前空仓/)
  assert.match(formatPositionStatus(emptyStatus), /现金: 200000\.00/)

  const state = defaultState(200000)
  applyBuy(
    state,
    [{ quote: { code: 'sh600519', name: '贵州茅台', price: 10 }, shares: 100, cost: 1000 }],
    { date: '2026-10-23' }
  )
  state.positions.push({
    code: 'sz000001',
    name: '平安银行',
    buyDate: '2026-10-24',
    buyPrice: 10,
    shares: 100,
    cost: 1000,
  })
  const mixed = positionStatus(state, '2026-10-24')
  assert.equal(mixed.total, 2)
  assert.equal(mixed.sellable.length, 1)
  assert.equal(mixed.frozen.length, 1)
  const text = formatPositionStatus(mixed)
  assert.match(text, /可卖: sh600519/)
  assert.match(text, /T\+1 不可卖: sz000001/)
})

test('代码归一化与主板判断', () => {
  assert.equal(normalizeCode('600519.SH'), 'sh600519')
  assert.equal(normalizeCode('000001'), 'sz000001')
  assert.equal(normalizeCode('sh000001'), 'sh000001')
  assert.equal(toOutputCode('sh600519'), '600519.SH')
  assert.equal(isMainBoard('sh600519'), true)
  assert.equal(isMainBoard('sz000001'), true)
  assert.equal(isMainBoard('sz300001'), false)
  assert.equal(isMainBoard('sh688001'), false)
})

test('腾讯行情解析字段与 stale 判定', () => {
  const quotes = parseQuoteText(quoteText())
  const quote = quotes.get('sh600519')
  assert.equal(quote.name, '贵州茅台')
  assert.equal(quote.price, 10)
  assert.equal(quote.lastClose, 9.6)
  assert.equal(quote.changePct, 4.17)
  assert.equal(quote.volRatio, 1.5)
  assert.equal(quote.turnoverPct, 7)
  assert.equal(quote.totalMcapYi, 100)
  assert.equal(quote.vwap, 9.9)
  assert.equal(quote.quoteDate, '2026-10-23')
  assert.equal(quote.isStale, false)

  const stale = parseQuoteText(quoteText({ 3: '9.60', 4: '9.60', 37: '0', 35: '9.60/0/0' })).get(
    'sh600519'
  )
  assert.equal(stale.isStale, true)
})

test('腾讯分时解析与 VWAP 累计值', () => {
  const node = minuteNode([
    '0930 9.70 100 97000',
    '0931 9.80 200 196000',
    '1430 10.00 1000 990000',
    '1500 10.10 1200 1212000',
    '1530 10.10 1201 1213010',
  ])
  const parsed = parseMinuteNode(node, '1430')
  assert.equal(parsed.date, '2026-10-23')
  assert.equal(parsed.rows.length, 3)
  assert.equal(parsed.rows[0].hhmm, '0930')
  assert.equal(parsed.rows[0].vwap, 9.7)
  assert.equal(parsed.rows[1].vwap, 9.8)
  assert.equal(parsed.rows[2].vwap, 9.9)
})

test('分时对齐与 14:30 当前 bar 补齐', () => {
  const minuteRows = [
    { hhmm: '0930', price: 9.7, vwap: 9.7, cumVolLots: 100, cumAmount: 97000 },
    { hhmm: '0931', price: 9.8, vwap: 9.8, cumVolLots: 200, cumAmount: 196000 },
    { hhmm: '1430', price: 10, vwap: 9.9, cumVolLots: 1000, cumAmount: 9900000 },
  ]
  const minuteBars = [
    { hhmm: '0930', open: 9.7, close: 9.7, high: 9.75, low: 9.65, volume: 100 },
    { hhmm: '0931', open: 9.8, close: 9.8, high: 9.9, low: 9.75, volume: 100 },
  ]
  const series = alignMinuteBars(minuteRows, minuteBars, '1430')
  assert.equal(series.length, 3)
  assert.equal(series[0].high, 9.75)
  assert.equal(series[2].high, 10)
  assert.equal(series[2].close, 10)
})

test('MA 与均线多头排列', () => {
  assert.equal(calcMA([1, 2, 3, 4, 5], 5), 3)
  assert.equal(calcMA([1, 2], 5), null)

  const bars = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    close: i + 1,
    volume: 100,
  }))
  const result = checkMaBullish(bars, 21, '2026-10-23')
  assert.equal(result.ok, true)
  assert.ok(result.ma5 > result.ma10 && result.ma10 > result.ma20)
})

test('近三日放量与当日折算', () => {
  const bars = [
    { date: '2026-10-20', close: 10, volume: 100 },
    { date: '2026-10-21', close: 10, volume: 110 },
    { date: '2026-10-22', close: 10, volume: 120 },
    { date: '2026-10-23', close: 10, volume: 999 },
  ]
  const ok = checkVolumeGrowth(bars, 130, '2026-10-23')
  assert.equal(ok.ok, true)
  const fail = checkVolumeGrowth(bars, 100, '2026-10-23')
  assert.equal(fail.ok, false)
})

test('分时始终在 VWAP 上方', () => {
  const series = buildVwapSeries([
    { hhmm: '0930', price: 10, vwap: 10 },
    { hhmm: '0931', price: 10.1, vwap: 10.05 },
    { hhmm: '0932', price: 10.2, vwap: 10.1 },
  ])
  assert.equal(checkAboveVwap(series, { minPoints: 3 }).ok, true)
  const broken = buildVwapSeries([
    { hhmm: '0930', price: 10, vwap: 10 },
    { hhmm: '0931', price: 10.0, vwap: 10.05 },
    { hhmm: '0932', price: 10.2, vwap: 10.1 },
  ])
  assert.equal(checkAboveVwap(broken, { minPoints: 3 }).ok, false)
})

test('尾盘创新高与回踩不破', () => {
  const base = [
    { hhmm: '1350', close: 9.95, high: 10, low: 9.9, vwap: 9.9 },
    { hhmm: '1400', close: 10.1, high: 10.2, low: 10, vwap: 10 },
    { hhmm: '1405', close: 10.4, high: 10.5, low: 10.2, vwap: 10.1 },
    { hhmm: '1410', close: 10.2, high: 10.3, low: 10.15, vwap: 10.1 },
  ]
  assert.equal(checkNewHighPullback(base).ok, true)

  const broken = base.map((row) =>
    row.hhmm === '1410' ? { ...row, low: 10.05, close: 10.05 } : row
  )
  assert.equal(checkNewHighPullback(broken).ok, false)

  const noPullback = base.slice(0, 3)
  assert.equal(checkNewHighPullback(noPullback).ok, false)
})

test('开盘分类与强弱判定', () => {
  assert.equal(classifyOpen(10.2, 10), 'high')
  assert.equal(classifyOpen(10.0, 10), 'flat')
  assert.equal(classifyOpen(9.8, 10), 'low')

  const strong = classifyStrength(
    sellMinutes({ close: 10.1, vwap: 10 }).map((row) => ({
      hhmm: row.hhmm,
      close: row.price,
      vwap: row.vwap,
    })),
    10.1
  )
  assert.equal(strong.strength, 'strong')

  const weak = classifyStrength(
    sellMinutes({ close: 9.9, vwap: 10 }).map((row) => ({
      hhmm: row.hhmm,
      close: row.price,
      vwap: row.vwap,
    })),
    9.9
  )
  assert.equal(weak.strength, 'weak')

  assert.equal(isRally(10.2, 10, 10.2), true)
  assert.equal(isRebound(10.1, 10.05, 10), true)
})

test('卖出规则 1~6 与截止清仓', () => {
  const now = { date: '2026-10-24', time: '09:35:00' }
  const highWeak = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 11, price: 10.9, lastClose: 10, high: 11 }),
    minuteRows: sellMinutes({ close: 10.9, vwap: 11 }),
    now,
  })
  assert.equal(highWeak.rule, 2)
  assert.equal(highWeak.orderType, 'close_position')

  const highStrong = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 11, price: 11.5, lastClose: 10, high: 11.5 }),
    minuteRows: sellMinutes({ close: 11.3, vwap: 11.2 }),
    now,
  })
  assert.equal(highStrong.rule, 1)
  assert.equal(highStrong.orderType, 'take_profit')

  const flatWeak = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 10, price: 9.9, lastClose: 10, high: 10.1 }),
    minuteRows: sellMinutes({ close: 9.9, vwap: 10.1 }),
    now,
  })
  assert.equal(flatWeak.rule, 4)

  const flatStrong = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 10, price: 10.2, lastClose: 10, high: 10.2 }),
    minuteRows: sellMinutes({ close: 10.15, vwap: 10.1 }),
    now,
  })
  assert.equal(flatStrong.rule, 3)

  const lowStrong = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 9.5, price: 9.8, lastClose: 10, high: 9.9 }),
    minuteRows: sellMinutes({ close: 9.8, vwap: 9.7 }),
    now,
  })
  assert.equal(lowStrong.rule, 5)

  const lowWeak = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ open: 9.5, price: 9.4, lastClose: 10, high: 9.6 }),
    minuteRows: sellMinutes({ close: 9.4, vwap: 9.6 }),
    now,
  })
  assert.equal(lowWeak.rule, 6)

  const deadline = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ quoteClock: '11:29:00' }),
    minuteRows: sellMinutes({ close: 10, vwap: 10 }),
    now: { date: '2026-10-24', time: '11:30:00' },
  })
  assert.equal(deadline.rule, 'deadline')
  assert.equal(deadline.orderType, 'close_position')
})

test('卖出侧行情时间滞后顺延', () => {
  const decision = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ quoteClock: '10:00:00' }),
    minuteRows: sellMinutes({ close: 10, vwap: 10 }),
    now: { date: '2026-10-24', time: '10:30:00' },
  })
  assert.equal(decision.action, 'defer')
  assert.match(decision.reason, /行情时间滞后/)
})

test('一字跌停顺延', () => {
  const decision = evaluateSellDecision({
    position: { code: 'sh600519', shares: 100 },
    quote: sellQuote({ isOneWordLimitDown: true }),
    minuteRows: sellMinutes({ close: 9, vwap: 9.5 }),
    now: { date: '2026-10-24', time: '09:35:00' },
  })
  assert.equal(decision.action, 'defer')
})

test('硬过滤条件', () => {
  const quote = parseQuoteText(quoteText()).get('sh600519')
  const now = { date: '2026-10-23', time: '14:30:00' }
  assert.equal(hardFilterQuote(quote, now).ok, true)
  assert.equal(hardFilterQuote({ ...quote, changePct: 6 }, now).ok, false)
  assert.equal(hardFilterQuote({ ...quote, volRatio: 1 }, now).ok, false)
  assert.equal(hardFilterQuote({ ...quote, turnoverPct: 11 }, now).ok, false)
  assert.equal(hardFilterQuote({ ...quote, totalMcapYi: 201 }, now).ok, false)
  assert.equal(isStOrDelisting('*ST 测试'), true)
  assert.equal(isStOrDelisting('退市测试'), true)
})

test('仓位计算与 50% 总仓位上限', () => {
  const candidates = [10, 20, 100].map((price) => ({ quote: { price } }))
  const orders = sizePositions(candidates, 1000000, {
    maxPositions: 3,
    singleMaxPct: 0.3,
    totalMaxPct: 0.5,
  })
  assert.equal(orders.length, 3)
  const total = orders.reduce((sum, order) => sum + order.cost, 0)
  assert.ok(total <= 500000 + 1e-6)
  for (const order of orders) {
    assert.equal(order.shares % 100, 0)
    assert.ok(order.cost <= 300000 + 1e-6)
  }
  const unaffordable = sizePositions([{ quote: { price: 10000 } }], 100000, {
    maxPositions: 3,
    singleMaxPct: 0.3,
    totalMaxPct: 0.5,
  })
  assert.equal(unaffordable.length, 0)
})

test('策略 JSON 输出与字段长度', () => {
  const quote = parseQuoteText(quoteText()).get('sh600519')
  const buy = buildBuyOrder({
    candidate: { quote },
    shares: 100,
    price: 10,
  })
  assert.equal(buy.order_type, 0)
  assert.equal(buy.stock_code, '600519.SH')
  assert.equal(buy.order_volume, 100)
  assert.ok(charLength(buy.reason) <= 30)
  assert.ok(charLength(buy.reason_detail) <= 150)

  const sell = buildSellOrder({
    position: { code: 'sz000001', name: '平安银行', shares: 500 },
    decision: { orderType: 'take_profit', priceType: 0, rule: 1 },
    price: 12.36,
  })
  assert.equal(sell.order_type, 1)
  assert.equal(sell.stock_code, '000001.SZ')
  assert.equal(sell.order_volume, 500)
  assert.ok(charLength(sell.reason) <= 30)
  assert.ok(charLength(sell.reason_detail) <= 150)
})

test('逐笔 VWAP 复核', () => {
  const series = [
    { hhmm: '0930', close: 10, high: 10.1, low: 9.9, vwap: 10 },
    { hhmm: '0931', close: 10.1, high: 10.2, low: 10, vwap: 10.05 },
    { hhmm: '1405', close: 10.5, high: 10.6, low: 10.4, vwap: 10.3 },
    { hhmm: '1410', close: 10.4, high: 10.5, low: 10.35, vwap: 10.3 },
  ]
  const ticks = [
    { time: '09:25:00', price: 10, volume: 100, amount: 100000 },
    { time: '09:30:00', price: 10, volume: 1, amount: 1000 },
    { time: '09:31:00', price: 10.1, volume: 2, amount: 2020 },
    { time: '14:05:00', price: 10.5, volume: 10, amount: 10500 },
    { time: '14:10:00', price: 10.4, volume: 5, amount: 5200 },
  ]
  const map = tickVwapByMinute(ticks, '1430')
  assert.equal(map.get('0925'), 10)
  assert.equal(map.get('0930'), 10)

  const checked = applyTickVwap({ series, metrics: {}, ok: true }, ticks, { minPoints: 2 })
  assert.equal(checked.ok, true)
  assert.ok(checked.metrics.tickVwap > 10)

  const brokenTicks = ticks.map((row) =>
    row.time === '14:05:00' ? { ...row, amount: 200000 } : row
  )
  const broken = applyTickVwap({ series, metrics: {}, ok: true }, brokenTicks, { minPoints: 2 })
  assert.equal(broken.ok, false)
})

test('逐笔文本解析', () => {
  const text =
    'v_detail_data_sh600519=[0,"0/09:25:00/1311.84/0.00/1049/137612016/M|1/09:30:01/1312.00/0.16/2/262400/B"];'
  const rows = parseTickText(text, 'sh600519', 0)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].volume, 1049)
  assert.equal(rows[0].amount, 137612016)
  assert.equal(rows[1].side, 'B')
})
