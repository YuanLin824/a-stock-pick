import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './args.mjs'
import { CONFIG } from './config.mjs'
import {
  fetchDailyKline,
  fetchMinute,
  fetchMinuteKline,
  fetchQuotes,
  fetchTicks,
  isMainBoard,
  normalizeCode,
} from './tencent.mjs'
import { inBuyWindow, inSellWindow, shanghaiNow, tradingDayStatus } from './market.mjs'
import {
  evaluateBuyCandidate,
  evaluateSellDecision,
  hardFilterQuote,
  rankCandidates,
  rejectCategory,
  sizePositions,
} from './strategy.mjs'
import { buildBuyOrder, buildOutput, buildSellOrder, emptyOutput } from './output.mjs'
import {
  LockError,
  acquireLock,
  applyBuy,
  applySell,
  formatPositionStatus,
  loadState,
  positionStatus,
  readUniverse,
  saveState,
  writeUniverse,
} from './portfolio.mjs'
import { applyTickVwap } from './indicators.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const resolvePath = (file) => path.resolve(ROOT, file)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createLogger({ verbose = false } = {}) {
  const dir = resolvePath(CONFIG.paths.logDir)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `overnight-${shanghaiNow().date}.log`)
  const write = (level, message) => {
    const line = `[${shanghaiNow().time}] ${level} ${message}`
    console.error(line)
    try {
      fs.appendFileSync(file, line + '\n')
    } catch {
      // logging must never break trading
    }
  }
  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
    debug: (message) => {
      if (verbose) write('DEBUG', message)
    },
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function parseCash(flags) {
  const cash = flags.cash == null ? CONFIG.initialCash : Number(flags.cash)
  if (!Number.isFinite(cash) || cash <= 0) throw new Error(`--cash 无效: ${flags.cash}`)
  return cash
}

async function ensureTradingDay(now, flags, logger) {
  if (flags.force) {
    logger.warn('--force：跳过交易日与时间窗口校验（仅用于测试）')
    return
  }
  const status = await tradingDayStatus(now.date, {
    cacheDir: resolvePath(CONFIG.paths.calendarDir),
  })
  if (!status.known) {
    logger.warn(`交易日历不可用，按 weekday 回退: ${status.error}`)
  }
  if (!status.open) throw new Error(`${now.date} 不是交易日`)
}

async function runBuy(flags, logger) {
  const now = shanghaiNow()
  await ensureTradingDay(now, flags, logger)
  if (!flags.force && !inBuyWindow(now)) {
    throw new Error(`不在买入窗口 ${CONFIG.buyWindow.start}–${CONFIG.buyWindow.end}`)
  }

  const release = acquireLock({ file: resolvePath(CONFIG.paths.lock) })
  try {
    const state = loadState({
      file: resolvePath(CONFIG.paths.state),
      initialCash: parseCash(flags),
    })
    if (state.positions.length) {
      throw new Error('已有持仓，请先在次日卖出窗口执行 sell，禁止把隔夜单拖成中线')
    }

    const universe = flags.codes
      ? [...new Set(String(flags.codes).split(',').map(normalizeCode).filter(isMainBoard))]
      : readUniverse(resolvePath(CONFIG.paths.universe))

    logger.info(`买入扫描开始：股票池 ${universe.length} 只，时间 ${now.time}`)
    const quotes = await fetchQuotes([...universe, 'sh000001', 'sz399001'])
    const shIndex = quotes.get('sh000001')
    const szIndex = quotes.get('sz399001')
    if (!shIndex || !szIndex) throw new Error('上证/深证指数行情缺失，无法判断强于大盘')

    const staleMinutes = flags.force ? 24 * 60 : CONFIG.staleQuoteMinutes
    const evaluationHhmm = '1430'
    const candidates = []
    const rejects = {}
    for (const code of universe) {
      const quote = quotes.get(code)
      const checked = hardFilterQuote(quote, now, staleMinutes)
      if (checked.ok) {
        candidates.push({ quote })
      } else {
        const category = rejectCategory(checked.reason)
        rejects[category] = (rejects[category] || 0) + 1
      }
    }
    logger.info(`硬过滤后 ${candidates.length} 只；淘汰原因 ${JSON.stringify(rejects)}`)
    logger.debug(`硬过滤候选: ${candidates.map((item) => item.quote.code).join(', ')}`)
    if (!candidates.length) return emptyOutput()

    let ranked = rankCandidates(candidates)
    if (ranked.length > CONFIG.maxEvaluate) {
      logger.warn(`候选超过 ${CONFIG.maxEvaluate} 只，按量比/换手/涨幅截取前 ${CONFIG.maxEvaluate}`)
      ranked = ranked.slice(0, CONFIG.maxEvaluate)
    }

    const evaluated = await mapLimit(ranked, CONFIG.concurrency, async (candidate) => {
      try {
        const [dailyBars, minute, minuteBars] = await Promise.all([
          fetchDailyKline(candidate.quote.code, 60),
          fetchMinute(candidate.quote.code, { cutoff: '1430' }),
          fetchMinuteKline(candidate.quote.code, 320),
        ])
        const indexQuote = candidate.quote.code.startsWith('sh') ? shIndex : szIndex
        return evaluateBuyCandidate({
          quote: candidate.quote,
          dailyBars,
          minuteRows: minute.rows,
          minuteBars,
          indexQuote,
          today: now.date,
          nowHhmm: evaluationHhmm,
        })
      } catch (error) {
        logger.warn(`${candidate.quote.code} 数据失败: ${error.message}`)
        return { ok: false, quote: candidate.quote, reasons: [error.message] }
      }
    })

    for (const result of evaluated) {
      if (!result.ok) logger.debug(`${result.quote.code} 未通过: ${result.reasons.join('；')}`)
    }
    let qualified = rankCandidates(evaluated.filter((item) => item.ok))
    logger.info(`10 条买入条件后合格 ${qualified.length} 只`)
    if (!qualified.length) return emptyOutput()

    const finalists = []
    for (const result of qualified.slice(0, CONFIG.maxTickChecks)) {
      if (finalists.length >= CONFIG.maxPositions) break
      try {
        const ticks = await fetchTicks(result.quote.code)
        const checked = applyTickVwap(result, ticks.rows)
        const minuteVwap = result.series[result.series.length - 1]?.vwap
        if (checked.metrics?.tickVwap != null && minuteVwap != null) {
          const diff = Math.abs(checked.metrics.tickVwap - minuteVwap) / minuteVwap
          if (diff > CONFIG.vwapMismatchTolerance) {
            logger.warn(
              `${result.quote.code} 逐笔 VWAP ${checked.metrics.tickVwap.toFixed(
                4
              )} 与分时 VWAP ${minuteVwap.toFixed(4)} 偏差 ${(diff * 100).toFixed(2)}%`
            )
          }
        }
        if (checked.ok) finalists.push(checked)
        else logger.warn(`${result.quote.code} 逐笔复核失败: ${checked.reasons.join('; ')}`)
      } catch (error) {
        logger.warn(`${result.quote.code} 逐笔失败，保留分钟结果: ${error.message}`)
        finalists.push(result)
      }
    }
    if (!finalists.length) return emptyOutput()

    const finishNow = shanghaiNow()
    if (!flags.force && finishNow.hhmm > '1457') {
      throw new Error(`买入扫描完成时 ${finishNow.time} 已超过 14:57，放弃本次买入`)
    }

    const orders = sizePositions(finalists, state.cash, CONFIG)
    if (!orders.length) return emptyOutput()

    const buyOrders = orders.map((order) =>
      buildBuyOrder({ candidate: order, shares: order.shares, price: order.quote.price })
    )

    if (!flags['dry-run']) {
      applyBuy(state, orders, { date: now.date })
      saveState(state, { file: resolvePath(CONFIG.paths.state) })
    }

    logger.info(
      `生成 ${buyOrders.length} 笔买入，剩余现金 ${state.cash.toFixed(2)}（${
        flags['dry-run'] ? 'dry-run 未落账' : '已写入状态'
      }）`
    )
    return buildOutput({ buyOrders })
  } finally {
    release()
  }
}

async function runSell(flags, logger) {
  const now = shanghaiNow()
  await ensureTradingDay(now, flags, logger)
  if (!flags.force && !inSellWindow(now)) {
    throw new Error(`不在卖出窗口 ${CONFIG.sellWindow.start}–${CONFIG.sellWindow.end}`)
  }

  const release = acquireLock({ file: resolvePath(CONFIG.paths.lock) })
  try {
    const state = loadState({
      file: resolvePath(CONFIG.paths.state),
      initialCash: parseCash(flags),
    })
    const status = positionStatus(state, now.date)
    if (!status.total) {
      logger.info('卖出操作结束：当前空仓')
      logger.info(formatPositionStatus(status))
      return emptyOutput()
    }
    if (!status.sellable.length) {
      logger.info('卖出操作结束：当前持仓均为 T+1 不可卖')
      logger.info(formatPositionStatus(status))
      return emptyOutput()
    }
    if (status.frozen.length) {
      logger.info(`有 ${status.frozen.length} 只持仓因 T+1 不可卖，本次只处理可卖持仓`)
      logger.info(formatPositionStatus(status))
    }
    let positions = status.sellable

    const watch = !flags.once
    const pollMs = (Number(flags.poll) || CONFIG.pollIntervalSec) * 1000
    const sellOrders = []
    let current = now

    while (true) {
      const quotes = await fetchQuotes(positions.map((position) => position.code))
      for (const position of [...positions]) {
        const quote = quotes.get(position.code)
        if (!quote) {
          logger.warn(`${position.code} 无行情，顺延`)
          continue
        }
        let minuteRows = []
        try {
          const minute = await fetchMinute(position.code, { cutoff: current.hhmm })
          minuteRows = minute.rows
        } catch (error) {
          logger.warn(`${position.code} 分时失败: ${error.message}`)
          continue
        }
        const decision = evaluateSellDecision({ position, quote, minuteRows, now: current })
        if (decision.action === 'sell' && quote.price != null) {
          const order = buildSellOrder({ position, decision, price: quote.price })
          sellOrders.push(order)
          if (!flags['dry-run']) {
            applySell(state, position, {
              price: quote.price,
              date: current.date,
              rule: decision.rule,
            })
            saveState(state, { file: resolvePath(CONFIG.paths.state) })
          }
          if (flags.stream) {
            process.stdout.write(`${JSON.stringify(buildOutput({ sellOrders: [order] }))}\n`)
          }
          positions = positions.filter((item) => item.code !== position.code)
          logger.info(
            `${position.code} ${position.name} 卖出 ${position.shares} 股 @ ${quote.price.toFixed(
              2
            )}，规则 ${decision.rule}（${decision.reason}）`
          )
        } else if (decision.action === 'defer') {
          logger.warn(`${position.code} 顺延: ${decision.reason}`)
        } else {
          logger.debug(`${position.code} 持有: ${decision.reason}`)
        }
      }

      if (!watch || !positions.length || current.hhmm >= '1130') break
      if (!flags.force && !inSellWindow(current)) break
      await sleep(pollMs)
      current = shanghaiNow()
    }

    if (!flags['dry-run'] && sellOrders.length) {
      saveState(state, { file: resolvePath(CONFIG.paths.state) })
    }
    logger.info(
      `卖出结束：成交 ${sellOrders.length} 笔，剩余持仓 ${positions.length} 只${
        flags['dry-run'] ? '（dry-run 未落账）' : ''
      }`
    )
    return buildOutput({ sellOrders })
  } finally {
    release()
  }
}

async function runCommand(flags, logger) {
  const now = shanghaiNow()
  if (flags.force) {
    const state = loadState({
      file: resolvePath(CONFIG.paths.state),
      initialCash: parseCash(flags),
    })
    if (state.positions.length) {
      return runSell({ ...flags, once: flags.once ?? true }, logger)
    }
    return runBuy(flags, logger)
  }
  if (inSellWindow(now)) return runSell(flags, logger)
  if (inBuyWindow(now)) return runBuy(flags, logger)
  logger.info(`当前 ${now.time} 不在买入/卖出窗口`)
  return emptyOutput()
}

function statusCommand() {
  const file = resolvePath(CONFIG.paths.state)
  if (!fs.existsSync(file)) {
    console.log('状态文件不存在；首次 buy/sell 时会按 --cash 初始化')
    return
  }
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`状态文件: ${file}`)
  console.log(`初始资金: ${state.initialCash}  现金: ${state.cash}`)
  console.log(`持仓: ${state.positions.length} 只`)
  for (const position of state.positions) {
    console.log(
      `  ${position.code} ${position.name} ${position.shares} 股 买入 ${position.buyDate} @ ${position.buyPrice}`
    )
  }
  console.log(`最近运行: ${JSON.stringify(state.lastRuns || {})}`)
}

function refreshUniverseCommand(flags) {
  const from = flags.from
    ? path.isAbsolute(flags.from)
      ? flags.from
      : path.resolve(ROOT, flags.from)
    : resolvePath(CONFIG.paths.universe)
  if (!fs.existsSync(from)) throw new Error(`代码源不存在: ${from}`)

  let codes = []
  if (from.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(from, 'utf8'))
    const list = Array.isArray(data.list) ? data.list : []
    codes = list
      .filter((item) => item && item.market && item.code)
      .map((item) => normalizeCode(`${item.market}${item.code}`))
  } else {
    codes = fs
      .readFileSync(from, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(normalizeCode)
  }
  codes = [...new Set(codes.filter(isMainBoard))].sort()
  if (!codes.length) {
    throw new Error('代码源中没有有效主板代码，拒绝覆盖 universe.txt')
  }
  const source = path.relative(ROOT, from).split(path.sep).join('/') || from
  const written = writeUniverse(codes, {
    file: resolvePath(CONFIG.paths.universe),
    source,
  })
  console.log(`已写入 ${written.length} 只主板代码 -> ${resolvePath(CONFIG.paths.universe)}`)
}

async function probeCommand(codeArg, flags = {}) {
  const code = normalizeCode(codeArg || 'sh600519')
  console.log(`probe ${code}`)
  const quotes = await fetchQuotes([code])
  const quote = quotes.get(code)
  if (!quote) throw new Error(`没有取到 ${code} 的行情`)
  console.log(
    JSON.stringify(
      {
        name: quote.name,
        price: quote.price,
        lastClose: quote.lastClose,
        open: quote.open,
        changePct: quote.changePct,
        high: quote.high,
        low: quote.low,
        turnoverPct: quote.turnoverPct,
        volRatio: quote.volRatio,
        totalMcapYi: quote.totalMcapYi,
        limitUp: quote.limitUp,
        limitDown: quote.limitDown,
        vwap: quote.vwap,
        quoteTime: quote.quoteTime,
        isStale: quote.isStale,
      },
      null,
      2
    )
  )

  const minute = await fetchMinute(code)
  const last = minute.rows[minute.rows.length - 1]
  const diff =
    last?.vwap != null && quote.vwap != null ? Math.abs(last.vwap - quote.vwap) / quote.vwap : null
  console.log(
    `分时: date=${minute.date} rows=${minute.rows.length} first=${minute.rows[0]?.hhmm} last=${
      last?.hhmm
    } lastVwap=${last?.vwap?.toFixed(4)} quoteVwap=${quote.vwap} diff=${diff}`
  )

  const minuteBars = await fetchMinuteKline(code, 320)
  console.log(
    `m1: ${minuteBars.length} 根 first=${minuteBars[0]?.t} last=${
      minuteBars[minuteBars.length - 1]?.t
    }`
  )
  const daily = await fetchDailyKline(code, 60)
  console.log(
    `daily: ${daily.length} 根 first=${daily[0]?.date} last=${daily[daily.length - 1]?.date}`
  )

  if (flags.ticks) {
    const ticks = await fetchTicks(code)
    console.log(`ticks: ${ticks.count} 笔 session=${ticks.sessionRows.length} vwap=${ticks.vwap}`)
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional.shift() || 'run'
  const logger = createLogger({ verbose: Boolean(flags.verbose) })
  const tradingCommands = new Set(['buy', 'sell', 'run'])

  try {
    let output = null
    if (command === 'buy') output = await runBuy(flags, logger)
    else if (command === 'sell') output = await runSell(flags, logger)
    else if (command === 'run') output = await runCommand(flags, logger)
    else if (command === 'status') statusCommand()
    else if (command === 'refresh-universe') refreshUniverseCommand(flags)
    else if (command === 'probe') await probeCommand(positional[0], flags)
    else
      throw new Error(
        `未知命令: ${command}（可用 buy / sell / run / status / refresh-universe / probe）`
      )

    if (tradingCommands.has(command)) {
      const hasSellOrders = output?.operations?.sell_orders?.length > 0
      if (flags.stream && hasSellOrders) {
        // 每笔卖出已由 runSell 即时输出，避免重复汇总
      } else {
        process.stdout.write(`${JSON.stringify(output, null, flags.pretty ? 2 : 0)}\n`)
      }
    }
  } catch (error) {
    logger.error(error.message)
    if (tradingCommands.has(command)) {
      process.stdout.write(`${JSON.stringify(emptyOutput())}\n`)
    }
    process.exitCode = error instanceof LockError ? 2 : 1
  }
}

main()
