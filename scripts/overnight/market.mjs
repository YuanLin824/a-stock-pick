import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export function shanghaiNow(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`
  const time = `${parts.hour}:${parts.minute}:${parts.second}`
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return {
    date,
    time,
    hhmm: `${parts.hour}${parts.minute}`,
    timestamp: now.getTime(),
    weekday,
  }
}

export function isWeekend(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

export function isInWindow(time, start, end) {
  const hm = time.slice(0, 5)
  return hm >= start && hm <= end
}

export function inBuyWindow(now) {
  return isInWindow(now.time, CONFIG.buyWindow.start, CONFIG.buyWindow.end)
}

export function inSellWindow(now) {
  return isInWindow(now.time, CONFIG.sellWindow.start, CONFIG.sellWindow.end)
}

export function classifyOpen(open, lastClose) {
  if (open == null || lastClose == null || lastClose <= 0) return null
  const ratio = open / lastClose - 1
  if (ratio >= 0.01) return 'high'
  if (ratio <= -0.01) return 'low'
  return 'flat'
}

function calendarCachePath(year, month, cacheDir = CONFIG.paths.calendarDir) {
  return path.join(cacheDir, `calendar-${year}-${String(month).padStart(2, '0')}.json`)
}

function readCalendarCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data && data.days && typeof data.days === 'object') return data
  } catch {
    return null
  }
  return null
}

async function fetchCalendar(year, month, cacheDir) {
  const file = calendarCachePath(year, month, cacheDir)
  const cached = readCalendarCache(file)
  if (cached) return cached

  const monthParam = `${year}-${month}`
  const url = `https://www.szse.cn/api/report/exchange/onepersistenthour/monthList?month=${monthParam}`
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: url },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`深交所交易日历 HTTP ${response.status}`)
  const json = await response.json()
  if (!Array.isArray(json?.data) || json.data.length === 0) {
    throw new Error(`深交所交易日历 ${monthParam} 返回为空`)
  }
  const days = {}
  for (const item of json.data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.jyrq || '')) continue
    if (!['0', '1'].includes(String(item.jybz))) continue
    days[item.jyrq] = String(item.jybz)
  }
  if (Object.keys(days).length === 0) {
    throw new Error(`深交所交易日历 ${monthParam} 没有有效日期`)
  }
  const data = { month: monthParam, fetchedAt: new Date().toISOString(), days }
  fs.mkdirSync(cacheDir, { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return data
}

export async function tradingDayStatus(date, { cacheDir = CONFIG.paths.calendarDir } = {}) {
  const [year, month] = date.split('-').map(Number)
  try {
    const calendar = await fetchCalendar(year, month, cacheDir)
    if (Object.prototype.hasOwnProperty.call(calendar.days, date)) {
      return {
        known: true,
        open: calendar.days[date] === '1',
        source: 'szse',
      }
    }
  } catch (error) {
    return {
      known: false,
      open: !isWeekend(date),
      source: 'weekday-fallback',
      error: error.message,
    }
  }
  return {
    known: false,
    open: !isWeekend(date),
    source: 'weekday-fallback',
    error: '深交所日历未包含该日期',
  }
}

export function timeToMinutes(time) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

export function minutesBetween(from, to) {
  return timeToMinutes(to) - timeToMinutes(from)
}
