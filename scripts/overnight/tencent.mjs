import { CONFIG } from './config.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const QUOTE_URL = 'https://qt.gtimg.cn/q='
const MINUTE_PATH = '/appstock/app/minute/query'
const DAY_PATH = '/appstock/app/day/query'
const TICK_URL = 'https://stock.gtimg.cn/data/index.php'
const KLINE_HOSTS = [
  'https://web.ifzq.gtimg.cn',
  'https://proxy.finance.qq.com/ifzqgtimg',
  'https://ifzq.gtimg.cn',
]

const hostDownUntil = new Map()
let gbkDecoder = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function getGbkDecoder() {
  if (!gbkDecoder) {
    try {
      gbkDecoder = new TextDecoder('gbk')
    } catch {
      throw new Error('当前 Node 不支持 TextDecoder("gbk")，请使用带完整 ICU 的 Node 版本')
    }
  }
  return gbkDecoder
}

function num(value) {
  if (value == null) return null
  const text = String(value).trim()
  if (text === '' || text === '-') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

function decodeBuffer(buffer, encoding) {
  if (encoding === 'gbk') return getGbkDecoder().decode(buffer)
  return new TextDecoder(encoding).decode(buffer)
}

async function fetchText(url, options = {}) {
  const {
    encoding = 'utf-8',
    headers = {},
    timeout = CONFIG.requestTimeoutMs,
    retries = 3,
    retryDelayMs = 400,
  } = options

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(timeout),
      })
      if (response.status === 403) {
        throw new HttpError(403, `HTTP 403（风控/拒绝访问）: ${url}`)
      }
      if (response.status === 429 || response.status >= 500) {
        throw new HttpError(response.status, `HTTP ${response.status}: ${url}`)
      }
      if (!response.ok) {
        throw new HttpError(response.status, `HTTP ${response.status}: ${url}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      return decodeBuffer(buffer, encoding)
    } catch (error) {
      lastError = error
      const noRetry = error instanceof HttpError && error.status === 403
      if (noRetry || attempt === retries) break
      await sleep(retryDelayMs * 2 ** attempt + Math.floor(Math.random() * 200))
    }
  }
  throw lastError
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`JSON 解析失败: ${url}: ${error.message}`)
  }
}

export function normalizeCode(code) {
  const text = String(code).trim().toLowerCase()
  if (/^[a-z]{2}\d{6}$/.test(text)) return text
  const suffixed = /^(\d{6})\.(sh|sz|bj)$/.exec(text)
  if (suffixed) return suffixed[2] + suffixed[1]
  if (/^\d{6}$/.test(text)) {
    if (text.startsWith('92')) return `bj${text}`
    if (/^[659]/.test(text)) return `sh${text}`
    if (/^[48]/.test(text)) return `bj${text}`
    return `sz${text}`
  }
  throw new Error(`无法识别的股票代码: ${code}`)
}

export function toOutputCode(code) {
  const normalized = normalizeCode(code)
  return `${normalized.slice(2)}.${normalized.slice(0, 2).toUpperCase()}`
}

export function isMainBoard(code) {
  const normalized = normalizeCode(code)
  return (
    /^sh(600|601|603|605)\d{3}$/.test(normalized) || /^sz(000|001|002|003)\d{3}$/.test(normalized)
  )
}

export function isIndexCode(code) {
  const normalized = normalizeCode(code)
  return /^sh(000|880|999)\d{3}$/.test(normalized) || /^sz399\d{3}$/.test(normalized)
}

export function parseQuoteText(text) {
  const result = new Map()
  const re = /v_([a-z]{2}\d{6})="([^"]*)"/g
  let match
  while ((match = re.exec(text)) !== null) {
    const code = match[1]
    const fields = match[2].split('~')
    if (fields.length < 52) continue

    const composite = String(fields[35] || '').split('/')
    const amountWan = num(fields[37])
    const amountYuan = num(composite[2]) ?? (amountWan == null ? null : amountWan * 1e4)
    const price = num(fields[3])
    const lastClose = num(fields[4])
    const limitUp = num(fields[47])
    const limitDown = num(fields[48])
    const high = num(fields[33])
    const low = num(fields[34])
    const quoteTime = /^\d{14}$/.test(fields[30]) ? fields[30] : null
    const quoteDate = quoteTime
      ? `${quoteTime.slice(0, 4)}-${quoteTime.slice(4, 6)}-${quoteTime.slice(6, 8)}`
      : null
    const quoteClock = quoteTime
      ? `${quoteTime.slice(8, 10)}:${quoteTime.slice(10, 12)}:${quoteTime.slice(12, 14)}`
      : null

    const isLimitUp = price != null && limitUp != null && price >= limitUp - 1e-6
    const isLimitDown = price != null && limitDown != null && price <= limitDown + 1e-6
    const sameHighLow = high != null && low != null && Math.abs(high - low) < 1e-9

    result.set(code, {
      code,
      name: fields[1] || '',
      price,
      lastClose,
      open: num(fields[5]),
      quoteTime,
      quoteDate,
      quoteClock,
      changeAmt: num(fields[31]),
      changePct: num(fields[32]),
      high,
      low,
      volumeLots: num(fields[36]),
      amountWan,
      amountYuan,
      turnoverPct: num(fields[38]),
      peTtm: num(fields[39]),
      amplitudePct: num(fields[43]),
      floatMcapYi: num(fields[44]),
      totalMcapYi: num(fields[45]),
      pb: num(fields[46]),
      limitUp,
      limitDown,
      volRatio: num(fields[49]),
      vwap: num(fields[51]),
      isStale:
        amountWan != null &&
        amountWan === 0 &&
        price != null &&
        lastClose != null &&
        price === lastClose &&
        price > 0,
      isLimitUp,
      isOneWordLimitUp: isLimitUp && sameHighLow,
      isLimitDown,
      isOneWordLimitDown: isLimitDown && sameHighLow,
    })
  }
  return result
}

export async function fetchQuotes(codes, options = {}) {
  const unique = [...new Set(codes.map(normalizeCode))]
  const batchSize = options.batchSize ?? CONFIG.quoteBatchSize
  const delayMs = options.delayMs ?? CONFIG.quoteBatchDelayMs
  const result = new Map()

  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize)
    const text = await fetchText(QUOTE_URL + batch.join(','), {
      encoding: 'gbk',
      headers: { Referer: 'https://gu.qq.com/' },
      timeout: options.timeout ?? CONFIG.requestTimeoutMs,
    })
    const parsed = parseQuoteText(text)
    if (parsed.size === 0) {
      throw new Error(`腾讯行情批次返回 0 条有效记录（${batch[0]}...${batch[batch.length - 1]}）`)
    }
    for (const [code, quote] of parsed) result.set(code, quote)
    if (i + batchSize < unique.length) await sleep(delayMs)
  }
  return result
}

export function parseMinuteNode(node, cutoff = '1500') {
  if (!node || !node.data || !Array.isArray(node.data.data)) {
    throw new Error('腾讯分时返回结构异常：缺少 data.data 数组')
  }
  const rawDate = String(node.data.date || '')
  const date = /^\d{8}$/.test(rawDate)
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
    : rawDate
  const rows = []
  for (const raw of node.data.data) {
    const parts = String(raw).trim().split(/\s+/)
    if (parts.length < 4) {
      throw new Error(`腾讯分时行格式异常: ${JSON.stringify(raw).slice(0, 80)}`)
    }
    const hhmm = parts[0].padStart(4, '0')
    const price = num(parts[1])
    const cumVolLots = num(parts[2])
    const cumAmount = num(parts[3])
    if (price == null || cumVolLots == null || cumAmount == null) {
      throw new Error(`腾讯分时行数值异常: ${JSON.stringify(raw).slice(0, 80)}`)
    }
    if (hhmm < '0930' || hhmm > cutoff) continue
    rows.push({
      hhmm,
      price,
      cumVolLots,
      cumAmount,
      vwap: cumVolLots > 0 ? cumAmount / (cumVolLots * 100) : null,
    })
  }
  return { date, rows }
}

async function fetchDataJson(pathName, query, { timeout = 20000 } = {}) {
  const errors = []
  for (const host of KLINE_HOSTS) {
    if ((hostDownUntil.get(host) || 0) > Date.now()) continue
    try {
      const json = await fetchJson(`${host}${pathName}?${query}`, {
        headers: { Referer: 'https://gu.qq.com/' },
        timeout,
        retries: 0,
      })
      if (json?.code === 0 && json?.data && typeof json.data === 'object') return json
      errors.push(`${host}: 空/异常响应`)
      hostDownUntil.set(host, Date.now() + CONFIG.klineHostCooldownMs)
    } catch (error) {
      errors.push(`${host}: ${error.message}`)
      hostDownUntil.set(host, Date.now() + CONFIG.klineHostCooldownMs)
    }
  }
  throw new Error(`腾讯分时三个入口均不可用: ${errors.join('; ')}`)
}

export async function fetchMinute(code, { cutoff = '1500', timeout } = {}) {
  const normalized = normalizeCode(code)
  const json = await fetchDataJson(MINUTE_PATH, `code=${normalized}`, { timeout })
  const node = json?.data?.[normalized]
  if (!node) throw new Error(`腾讯分时没有返回 ${normalized} 的数据`)
  return parseMinuteNode(node, cutoff)
}

export async function fetchMinuteDays(code, count = 5, { timeout } = {}) {
  const normalized = normalizeCode(code)
  const json = await fetchDataJson(DAY_PATH, `code=${normalized}`, { timeout })
  const node = json?.data?.[normalized]?.data
  if (!node || typeof node !== 'object') {
    throw new Error(`腾讯 5 日分时没有返回 ${normalized} 的数据`)
  }
  const days = Object.values(node)
    .map((day) => parseMinuteNode({ data: day }, '1500'))
    .sort((a, b) => a.date.localeCompare(b.date))
  return days.slice(-count)
}

function parseKlineItem(item) {
  const date = String(item[0] || '')
  const open = num(item[1])
  const close = num(item[2])
  const high = num(item[3])
  const low = num(item[4])
  const volume = num(item[5])
  if (open == null || close == null || high == null || low == null || volume == null) {
    throw new Error(`腾讯 K 线数值异常: ${JSON.stringify(item).slice(0, 100)}`)
  }
  return { date, open, close, high, low, volume }
}

function parseMinuteItem(item) {
  const datetime = String(item[0] || '')
  const open = num(item[1])
  const close = num(item[2])
  const high = num(item[3])
  const low = num(item[4])
  const volume = num(item[5])
  if (open == null || close == null || high == null || low == null || volume == null) {
    throw new Error(`腾讯分钟 K 线数值异常: ${JSON.stringify(item).slice(0, 100)}`)
  }
  const t = /^\d{12}$/.test(datetime)
    ? `${datetime.slice(0, 4)}-${datetime.slice(4, 6)}-${datetime.slice(6, 8)} ${datetime.slice(8, 10)}:${datetime.slice(10, 12)}`
    : datetime
  return { t, open, close, high, low, volume, hhmm: t.slice(11, 13) + t.slice(14, 16) }
}

async function fetchKline(path, param, { timeout = 20000 } = {}) {
  const errors = []
  for (const host of KLINE_HOSTS) {
    if ((hostDownUntil.get(host) || 0) > Date.now()) continue
    try {
      const json = await fetchJson(`${host}${path}?param=${param}`, {
        headers: { Referer: 'https://gu.qq.com/' },
        timeout,
        retries: 0,
      })
      if (json?.msg === 'param error') {
        throw new Error(`腾讯 K 线参数错误: ${param}`)
      }
      if (json?.data && typeof json.data === 'object' && Object.keys(json.data).length > 0) {
        return json
      }
      errors.push(`${host}: 空响应`)
      hostDownUntil.set(host, Date.now() + CONFIG.klineHostCooldownMs)
    } catch (error) {
      if (String(error.message).includes('参数错误')) throw error
      errors.push(`${host}: ${error.message}`)
      hostDownUntil.set(host, Date.now() + CONFIG.klineHostCooldownMs)
    }
  }
  throw new Error(`腾讯 K 线三个入口均不可用: ${errors.join('; ')}`)
}

export async function fetchDailyKline(code, count = 60, options = {}) {
  const normalized = normalizeCode(code)
  const json = await fetchKline(
    '/appstock/app/fqkline/get',
    `${normalized},day,,,${count},qfq`,
    options
  )
  const node = json.data?.[normalized]
  const items = node?.qfqday ?? node?.day
  if (!Array.isArray(items)) {
    throw new Error(`腾讯日线没有返回 ${normalized} 的 K 线数组`)
  }
  return items.map(parseKlineItem).sort((a, b) => a.date.localeCompare(b.date))
}

export async function fetchMinuteKline(code, count = 320, options = {}) {
  const normalized = normalizeCode(code)
  const json = await fetchKline('/appstock/app/kline/mkline', `${normalized},m1,,${count}`, options)
  const items = json.data?.[normalized]?.m1
  if (!Array.isArray(items)) {
    throw new Error(`腾讯分钟线没有返回 ${normalized} 的 m1 数组`)
  }
  return items.map(parseMinuteItem)
}

export function parseTickText(text, code, page) {
  const pattern = new RegExp(`v_detail_data_${code}=\\[(\\d+),"([^"]*)"\\];?`)
  const match = pattern.exec(text.trim())
  if (!match) throw new Error(`腾讯逐笔 ${code} 第 ${page} 页格式异常`)
  if (Number(match[1]) !== page) {
    throw new Error(`腾讯逐笔 ${code} 返回页码 ${match[1]}，期望 ${page}`)
  }
  if (!match[2]) return []
  return match[2].split('|').map((item) => {
    const parts = item.split('/')
    if (parts.length !== 7 || !/^\d\d:\d\d:\d\d$/.test(parts[1])) {
      throw new Error(`腾讯逐笔 ${code} 记录格式异常: ${item.slice(0, 80)}`)
    }
    const seq = Number(parts[0])
    const price = num(parts[2])
    const change = num(parts[3])
    const volume = num(parts[4])
    const amount = num(parts[5])
    const side = parts[6]
    if (
      !Number.isInteger(seq) ||
      price == null ||
      change == null ||
      volume == null ||
      amount == null
    ) {
      throw new Error(`腾讯逐笔 ${code} 数值异常: ${item.slice(0, 80)}`)
    }
    if (!['B', 'S', 'M'].includes(side)) {
      throw new Error(`腾讯逐笔 ${code} side 异常: ${side}`)
    }
    return { seq, time: parts[1], price, change, volume, amount, side }
  })
}

export async function fetchTicks(code, { cutoff = '15:00:59' } = {}) {
  const normalized = normalizeCode(code)
  if (isIndexCode(normalized) || normalized.startsWith('bj')) {
    throw new Error(`腾讯逐笔不支持指数/北交所: ${normalized}`)
  }
  const rows = []
  let emptyPage = false
  for (let page = 0; page < CONFIG.tickMaxPages; page++) {
    const query = new URLSearchParams({
      appn: 'detail',
      action: 'data',
      c: normalized,
      p: String(page),
    })
    const text = await fetchText(`${TICK_URL}?${query.toString()}`, {
      encoding: 'gbk',
      headers: { Referer: 'https://gu.qq.com/' },
    })
    if (!text.trim()) {
      emptyPage = true
      break
    }
    const pageRows = parseTickText(text, normalized, page)
    if (pageRows.length === 0) {
      emptyPage = true
      break
    }
    rows.push(...pageRows)
    await sleep(CONFIG.tickPageDelayMs)
  }
  if (!emptyPage) {
    throw new Error(`腾讯逐笔 ${normalized} 翻到 ${CONFIG.tickMaxPages} 页仍未结束`)
  }
  if (rows.length === 0) {
    throw new Error(`腾讯逐笔 ${normalized} 为空（停牌/未开盘/接口异常）`)
  }
  const sessionRows = rows.filter((row) => row.time <= cutoff)
  const amount = sessionRows.reduce((sum, row) => sum + row.amount, 0)
  const volumeLots = sessionRows.reduce((sum, row) => sum + row.volume, 0)
  return {
    rows,
    sessionRows,
    vwap: volumeLots > 0 ? amount / (volumeLots * 100) : null,
    count: rows.length,
  }
}
