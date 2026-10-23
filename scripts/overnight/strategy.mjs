import { CONFIG } from './config.mjs'
import { classifyOpen } from './market.mjs'
import {
  alignMinuteBars,
  appendCurrentBar,
  buildVwapSeries,
  checkAboveVwap,
  checkMaBullish,
  checkNewHighPullback,
  checkVolumeGrowth,
  classifyStrength,
  fillSyntheticVwap,
  isRally,
  isRebound,
} from './indicators.mjs'
import { isMainBoard } from './tencent.mjs'

const EPS = 1e-9

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null
}

function minutesOf(time) {
  const [hour, minute, second = 0] = String(time || '00:00:00')
    .split(':')
    .map(Number)
  return hour * 60 + minute + second / 60
}

export function isStOrDelisting(name) {
  const text = String(name || '').toUpperCase()
  return text.includes('ST') || text.includes('退')
}

export function isQuoteFresh(quote, now, staleMinutes = CONFIG.staleQuoteMinutes) {
  if (!quote?.quoteDate || !quote?.quoteClock) return false
  if (quote.quoteDate !== now.date) return false
  return minutesOf(now.time) - minutesOf(quote.quoteClock) <= staleMinutes
}

export function hardFilterQuote(quote, now, staleMinutes = CONFIG.staleQuoteMinutes) {
  if (!quote) return { ok: false, reason: '无行情' }
  if (!isMainBoard(quote.code)) return { ok: false, reason: '非主板' }
  if (isStOrDelisting(quote.name)) return { ok: false, reason: 'ST/退市' }
  if (quote.isStale) return { ok: false, reason: '停牌/僵尸报价' }
  if (!isQuoteFresh(quote, now, staleMinutes)) return { ok: false, reason: '行情时间滞后' }
  if (quote.price == null || quote.price <= 0) return { ok: false, reason: '现价缺失' }
  if (quote.isLimitUp || quote.isOneWordLimitUp) return { ok: false, reason: '涨停/一字板' }
  if (
    quote.changePct == null ||
    quote.changePct < CONFIG.minChangePct ||
    quote.changePct > CONFIG.maxChangePct
  ) {
    return {
      ok: false,
      reason: `涨幅 ${quote.changePct}% 不在 ${CONFIG.minChangePct}%~${CONFIG.maxChangePct}%`,
    }
  }
  if (quote.volRatio == null || quote.volRatio <= CONFIG.minVolRatio) {
    return { ok: false, reason: `量比 ${quote.volRatio} 不大于 ${CONFIG.minVolRatio}` }
  }
  if (
    quote.turnoverPct == null ||
    quote.turnoverPct < CONFIG.minTurnoverPct ||
    quote.turnoverPct > CONFIG.maxTurnoverPct
  ) {
    return {
      ok: false,
      reason: `换手率 ${quote.turnoverPct}% 不在 ${CONFIG.minTurnoverPct}%~${CONFIG.maxTurnoverPct}%`,
    }
  }
  if (
    quote.totalMcapYi == null ||
    quote.totalMcapYi < CONFIG.minMcapYi ||
    quote.totalMcapYi > CONFIG.maxMcapYi
  ) {
    return {
      ok: false,
      reason: `总市值 ${quote.totalMcapYi} 亿不在 ${CONFIG.minMcapYi}~${CONFIG.maxMcapYi} 亿`,
    }
  }
  return { ok: true }
}

export function rejectCategory(reason) {
  const text = String(reason || '')
  if (text.startsWith('涨幅')) return '涨幅不在 3%~5%'
  if (text.startsWith('量比')) return '量比<=1'
  if (text.startsWith('换手率')) return '换手率不在 5%~10%'
  if (text.startsWith('总市值')) return '总市值不在 50~200 亿'
  return text || '未知原因'
}

export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const av = a.quote.volRatio ?? -Infinity
    const bv = b.quote.volRatio ?? -Infinity
    if (bv !== av) return bv - av
    const at = a.quote.turnoverPct ?? -Infinity
    const bt = b.quote.turnoverPct ?? -Infinity
    if (bt !== at) return bt - at
    const ac = a.quote.changePct ?? -Infinity
    const bc = b.quote.changePct ?? -Infinity
    return bc - ac
  })
}

export function evaluateBuyCandidate({
  quote,
  dailyBars,
  minuteRows,
  minuteBars,
  indexQuote,
  today,
  nowHhmm,
}) {
  const reasons = []
  const ma = checkMaBullish(dailyBars, quote.price, today)
  if (!ma.ok) reasons.push(ma.reason || '均线不满足')

  const todayCumVolLots = last(minuteRows)?.cumVolLots ?? quote.volumeLots ?? null
  const volume = checkVolumeGrowth(dailyBars, todayCumVolLots, today)
  if (!volume.ok) reasons.push(volume.reason || '近三日量能不足')

  const todayMinuteBars = minuteBars.filter((bar) => bar.t.startsWith(today))
  let series = alignMinuteBars(minuteRows, todayMinuteBars, '1430')
  const lastRow = last(series)
  if (!lastRow || lastRow.hhmm < nowHhmm) {
    series = appendCurrentBar(series, {
      hhmm: nowHhmm,
      price: quote.price,
      high: quote.price,
      low: quote.price,
      vwap: quote.vwap,
    })
  }
  series = fillSyntheticVwap(series)

  const aboveVwap = checkAboveVwap(series)
  if (!aboveVwap.ok) reasons.push(aboveVwap.reason || '分时跌破 VWAP')

  const newHigh = checkNewHighPullback(series, { from: '1400', to: '1430' })
  if (!newHigh.ok) reasons.push(newHigh.reason || '尾盘未创新高/回踩失败')

  const indexPct = indexQuote?.changePct ?? null
  const strongerThanIndex =
    indexPct != null && quote.changePct != null && quote.changePct > indexPct
  if (!strongerThanIndex) reasons.push('未强于大盘')

  return {
    ok: reasons.length === 0,
    reasons,
    quote,
    series,
    metrics: {
      ma5: ma.ma5,
      ma10: ma.ma10,
      ma20: ma.ma20,
      volume,
      aboveVwap,
      newHigh,
      indexPct,
      strongerThanIndex,
      todayCumVolLots,
    },
  }
}

export function evaluateSellDecision({ position, quote, minuteRows, now }) {
  if (!quote || quote.price == null) {
    return { action: 'defer', reason: '无有效报价' }
  }
  if (quote.isStale || !isQuoteFresh(quote, now, CONFIG.sellStaleMinutes)) {
    return { action: 'defer', reason: '停牌/行情时间滞后' }
  }
  if (quote.isOneWordLimitDown) {
    return { action: 'defer', reason: '一字跌停无法卖出' }
  }

  const nowHhmm = now.time.slice(0, 5).replace(':', '')
  const series = buildVwapSeries(minuteRows, nowHhmm)
  const strength = classifyStrength(series, quote.price)
  const openType = classifyOpen(quote.open, quote.lastClose)
  const rally = isRally(quote.price, quote.open, quote.high)
  const rebound = isRebound(quote.price, strength.vwap, quote.lastClose)
  const deadline = nowHhmm >= '1130'
  const belowOpen = quote.open != null && quote.price < quote.open - EPS
  const belowVwap = strength.vwap != null && quote.price < strength.vwap - EPS
  const weak5 = strength.strength === 'weak'

  if (deadline) {
    return {
      action: 'sell',
      orderType: 'close_position',
      priceType: 1,
      rule: 'deadline',
      reason: '最迟 11:30 清仓',
      metrics: { openType, strength, rally, rebound, deadline },
    }
  }

  if (openType === 'high') {
    if (weak5 || belowVwap || belowOpen) {
      return {
        action: 'sell',
        orderType: 'close_position',
        priceType: 1,
        rule: 2,
        reason: '高开走弱，跌破均价线/开盘价',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
    if (strength.strength === 'strong' && rally) {
      return {
        action: 'sell',
        orderType: 'take_profit',
        priceType: 0,
        rule: 1,
        reason: '高开走强，冲高止盈',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
  } else if (openType === 'flat') {
    if (weak5 || belowOpen) {
      return {
        action: 'sell',
        orderType: 'close_position',
        priceType: 1,
        rule: 4,
        reason: '平开走弱，直接卖出',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
    if (strength.strength === 'strong' && rally) {
      return {
        action: 'sell',
        orderType: 'take_profit',
        priceType: 0,
        rule: 3,
        reason: '平开走强，冲高止盈',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
  } else if (openType === 'low') {
    if (weak5 || belowOpen) {
      return {
        action: 'sell',
        orderType: 'close_position',
        priceType: 1,
        rule: 6,
        reason: '低开走弱，开盘直接卖出',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
    if (strength.strength === 'strong' && rebound) {
      return {
        action: 'sell',
        orderType: 'close_position',
        priceType: 1,
        rule: 5,
        reason: '低开反抽，减亏离场',
        metrics: { openType, strength, rally, rebound, deadline },
      }
    }
  }

  return {
    action: 'hold',
    orderType: null,
    priceType: null,
    rule: null,
    reason: '未触发卖出条件',
    metrics: { openType, strength, rally, rebound, deadline },
  }
}

export function sizePositions(candidates, totalAssets, config) {
  const maxPositions = config.maxPositions ?? 3
  const singleMaxPct = config.singleMaxPct ?? 0.3
  const totalMaxPct = config.totalMaxPct ?? 0.5
  let selected = candidates.slice(0, maxPositions)

  for (let round = 0; round < 3; round++) {
    if (!selected.length) break
    const n = selected.length
    const targetPerOrder = Math.min(totalAssets * singleMaxPct, (totalAssets * totalMaxPct) / n)
    const active = selected.filter((candidate) => {
      const price = candidate.quote.price
      return price > 0 && Math.floor(targetPerOrder / price / 100) * 100 > 0
    })
    if (active.length === selected.length) break
    selected = active
  }

  if (!selected.length) return []
  const n = selected.length
  const targetPerOrder = Math.min(totalAssets * singleMaxPct, (totalAssets * totalMaxPct) / n)
  const orders = []
  let totalCost = 0
  for (const candidate of selected) {
    const price = candidate.quote.price
    let shares = Math.floor(targetPerOrder / price / 100) * 100
    const remainingCap = Math.max(0, totalAssets * totalMaxPct - totalCost)
    if (shares * price > remainingCap) {
      shares = Math.floor(remainingCap / price / 100) * 100
    }
    if (shares <= 0) continue
    const cost = shares * price
    totalCost += cost
    orders.push({ ...candidate, shares, targetAmount: targetPerOrder, cost })
  }
  return orders
}
