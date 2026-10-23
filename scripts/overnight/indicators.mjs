const EPS = 1e-9

function last(arr) {
  return arr.length ? arr[arr.length - 1] : null
}

export function buildVwapSeries(minuteRows, cutoff = '1430') {
  return minuteRows
    .filter((row) => row.hhmm >= '0930' && row.hhmm <= cutoff)
    .map((row) => ({
      hhmm: row.hhmm,
      close: row.price,
      price: row.price,
      vwap: row.vwap,
      cumVolLots: row.cumVolLots,
      cumAmount: row.cumAmount,
    }))
}

export function alignMinuteBars(minuteRows, minuteBars, cutoff = '1430') {
  const barMap = new Map(minuteBars.map((bar) => [bar.hhmm, bar]))
  const rows = minuteRows.filter((row) => row.hhmm >= '0930' && row.hhmm <= cutoff)
  const aligned = []
  let previousClose = null
  for (const row of rows) {
    const bar = barMap.get(row.hhmm)
    const close = bar?.close ?? row.price ?? previousClose
    if (close == null) continue
    const high = bar?.high ?? Math.max(close, previousClose ?? close)
    const low = bar?.low ?? Math.min(close, previousClose ?? close)
    aligned.push({
      hhmm: row.hhmm,
      close,
      high,
      low,
      vwap: row.vwap,
      cumVolLots: row.cumVolLots,
      cumAmount: row.cumAmount,
    })
    previousClose = close
  }
  return aligned
}

export function appendCurrentBar(series, { hhmm, price, high, low, vwap = null }) {
  if (price == null) return series
  if (series.length && series[series.length - 1].hhmm >= hhmm) return series
  return [
    ...series,
    {
      hhmm,
      close: price,
      high: high ?? price,
      low: low ?? price,
      vwap,
      synthetic: true,
    },
  ]
}

export function fillSyntheticVwap(series) {
  if (!series.length || series.every((row) => row.vwap != null)) return series
  const filled = []
  let previousVwap = null
  for (const row of series) {
    const vwap = row.vwap ?? previousVwap
    filled.push({ ...row, vwap })
    if (vwap != null) previousVwap = vwap
  }
  return filled
}

export function calcMA(values, n) {
  if (!Array.isArray(values) || values.length < n) return null
  const slice = values.slice(-n)
  if (slice.some((value) => value == null || !Number.isFinite(value))) return null
  return slice.reduce((sum, value) => sum + value, 0) / n
}

export function checkMaBullish(dailyBars, livePrice, today) {
  const closes = dailyBars.map((bar) => bar.close)
  if (!closes.length || livePrice == null) return { ok: false, reason: '日线或现价缺失' }
  const lastBar = dailyBars[dailyBars.length - 1]
  if (lastBar.date === today) closes[closes.length - 1] = livePrice
  else closes.push(livePrice)
  const ma5 = calcMA(closes, 5)
  const ma10 = calcMA(closes, 10)
  const ma20 = calcMA(closes, 20)
  if (ma5 == null || ma10 == null || ma20 == null) {
    return { ok: false, reason: '日线不足 20 根', ma5, ma10, ma20 }
  }
  return {
    ok: ma5 > ma10 && ma10 > ma20 && livePrice >= ma5 - EPS,
    ma5,
    ma10,
    ma20,
    closes,
  }
}

export function checkVolumeGrowth(dailyBars, todayCumVolLots, today) {
  const previous = dailyBars.filter((bar) => bar.date < today)
  if (previous.length < 3) {
    return { ok: false, reason: '完整交易日不足 3 天' }
  }
  const [t3, t2, t1] = previous.slice(-3)
  if (todayCumVolLots == null || todayCumVolLots <= 0) {
    return { ok: false, reason: '当日累计成交量缺失' }
  }
  const projected = (todayCumVolLots * 240) / 210
  return {
    ok: t1.volume > t2.volume && t2.volume > t3.volume && projected > t1.volume,
    projected,
    vT1: t1.volume,
    vT2: t2.volume,
    vT3: t3.volume,
    dates: [t3.date, t2.date, t1.date],
  }
}

export function checkAboveVwap(series, { minPoints = 60 } = {}) {
  let points = 0
  let worst = null
  let worstAt = null
  for (const row of series) {
    if (row.vwap == null || row.vwap <= 0 || row.close == null) continue
    const ratio = row.close / row.vwap
    points++
    if (worst == null || ratio < worst) {
      worst = ratio
      worstAt = row.hhmm
    }
    if (ratio < 1 - EPS) {
      return { ok: false, worst, worstAt, points, reason: `${row.hhmm} 收盘价跌破 VWAP` }
    }
  }
  if (points < minPoints) {
    return { ok: false, worst, worstAt, points, reason: `有效分钟数不足 ${minPoints}` }
  }
  return { ok: true, worst, worstAt, points }
}

export function checkNewHighPullback(series, { from = '1400', to = '1430' } = {}) {
  const window = series.filter((row) => row.hhmm >= from && row.hhmm <= to)
  const before = series.filter((row) => row.hhmm < from)
  if (window.length < 2) {
    return { ok: false, reason: '14:00–14:30 数据不足' }
  }
  const preHigh = before.length ? Math.max(...before.map((row) => row.high)) : -Infinity
  let high = -Infinity
  let highIndex = -1
  for (let i = 0; i < window.length; i++) {
    if (window[i].high > high) {
      high = window[i].high
      highIndex = i
    }
  }
  if (!(high > preHigh + EPS)) {
    return { ok: false, reason: '窗口内未创当日新高', high, preHigh }
  }
  // 回踩必须出现在创新高之后的分钟；同一分钟内高低点的先后顺序无法判定，按未回踩处理。
  const after = window.slice(highIndex + 1)
  if (!after.length) {
    return { ok: false, reason: '创新高后未回踩', high, highAt: window[highIndex].hhmm }
  }
  let pullbackLow = Infinity
  let pullbackAt = null
  let pullbackVwap = null
  for (const row of after) {
    if (row.low < pullbackLow) {
      pullbackLow = row.low
      pullbackAt = row.hhmm
      pullbackVwap = row.vwap
    }
  }
  if (pullbackLow >= high - EPS) {
    return { ok: false, reason: '创新高后未回踩', high, highAt: window[highIndex].hhmm }
  }
  if (pullbackVwap == null || pullbackVwap <= 0) {
    return { ok: false, reason: '回踩时 VWAP 缺失', high, highAt: window[highIndex].hhmm }
  }
  return {
    ok: pullbackLow >= pullbackVwap - EPS,
    high,
    highAt: window[highIndex].hhmm,
    pullbackLow,
    pullbackAt,
    pullbackVwap,
    reason: pullbackLow >= pullbackVwap - EPS ? null : '回踩跌破 VWAP',
  }
}

export function classifyStrength(series, currentPrice, { weakMinutes = 5 } = {}) {
  if (!series.length || currentPrice == null) return { strength: null, vwap: null }
  const lastRow = last(series)
  const vwap = lastRow.vwap
  if (vwap == null || vwap <= 0) return { strength: null, vwap: null }
  const recent = series.slice(-weakMinutes)
  const weak =
    recent.length >= weakMinutes &&
    recent.every((row) => row.vwap != null && row.close < row.vwap - EPS)
  const strong = !weak && currentPrice >= vwap - EPS
  return {
    strength: weak ? 'weak' : strong ? 'strong' : 'neutral',
    vwap,
    weak,
    strong,
  }
}

export function isRally(price, open, dayHigh) {
  if (price == null || open == null || open <= 0) return false
  if (price >= open * 1.01 - EPS) return true
  return dayHigh != null && dayHigh > open && price >= dayHigh - EPS
}

export function isRebound(price, vwap, lastClose) {
  if (price == null) return false
  if (vwap != null && price >= vwap - EPS) return true
  return lastClose != null && price >= lastClose - EPS
}

export function pct(price, base) {
  if (price == null || base == null || base <= 0) return null
  return (price / base - 1) * 100
}

export function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null
  return Number(value.toFixed(digits))
}

export function tickVwapByMinute(tickRows, cutoff = '1500') {
  const map = new Map()
  let amount = 0
  let volumeLots = 0
  for (const row of tickRows) {
    if (row.time > '15:00:59') continue
    amount += row.amount
    volumeLots += row.volume
    const hhmm = row.time.slice(0, 5).replace(':', '')
    if (hhmm <= cutoff) map.set(hhmm, volumeLots > 0 ? amount / (volumeLots * 100) : null)
  }
  return map
}

export function applyTickVwap(result, tickRows, { minPoints = 60 } = {}) {
  const map = tickVwapByMinute(tickRows, '1430')
  let previous = null
  for (const [hhmm, vwap] of map) {
    if (hhmm < '0930') previous = vwap
    else break
  }
  const series = result.series.map((row) => {
    const vwap = map.get(row.hhmm) ?? previous
    if (vwap != null) previous = vwap
    return { ...row, vwap }
  })
  const aboveVwap = checkAboveVwap(series, { minPoints })
  const newHigh = checkNewHighPullback(series, { from: '1400', to: '1430' })
  const reasons = []
  if (!aboveVwap.ok) reasons.push(aboveVwap.reason || '逐笔 VWAP 不满足')
  if (!newHigh.ok) reasons.push(newHigh.reason || '逐笔回踩不满足')
  return {
    ...result,
    ok: reasons.length === 0,
    reasons,
    series,
    metrics: {
      ...result.metrics,
      aboveVwap,
      newHigh,
      tickVwap: series.length ? series[series.length - 1].vwap : null,
    },
  }
}
