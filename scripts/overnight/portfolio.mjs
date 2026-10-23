import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'
import { normalizeCode } from './tencent.mjs'

const HISTORY_LIMIT = 200

export class LockError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LockError'
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function atomicWriteJson(file, data) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export function defaultState(initialCash = CONFIG.initialCash) {
  const now = new Date().toISOString()
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    initialCash,
    cash: initialCash,
    positions: [],
    history: [],
    lastRuns: {},
  }
}

function validateState(state) {
  if (!state || typeof state !== 'object') throw new Error('状态文件不是对象')
  if (typeof state.cash !== 'number' || !Number.isFinite(state.cash)) {
    throw new Error('状态文件 cash 无效')
  }
  if (!Array.isArray(state.positions)) throw new Error('状态文件 positions 不是数组')
  for (const position of state.positions) {
    if (!/^[a-z]{2}\d{6}$/.test(position.code || '')) {
      throw new Error(`状态文件持仓代码无效: ${position.code}`)
    }
    if (!Number.isInteger(position.shares) || position.shares <= 0) {
      throw new Error(`状态文件持仓股数无效: ${position.code}`)
    }
    if (!position.buyDate || !Number.isFinite(position.buyPrice)) {
      throw new Error(`状态文件持仓买入信息无效: ${position.code}`)
    }
  }
  return state
}

export function loadState({ file = CONFIG.paths.state, initialCash = CONFIG.initialCash } = {}) {
  if (!fs.existsSync(file)) {
    const state = defaultState(initialCash)
    atomicWriteJson(file, state)
    return state
  }
  let state
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`状态文件损坏，拒绝覆盖: ${file}: ${error.message}`)
  }
  return validateState(state)
}

export function saveState(state, { file = CONFIG.paths.state } = {}) {
  state.updatedAt = new Date().toISOString()
  atomicWriteJson(file, state)
}

export function pushHistory(state, entry) {
  state.history = state.history || []
  state.history.push(entry)
  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(-HISTORY_LIMIT)
  }
}

export function applyBuy(state, orders, { date, timestamp = new Date().toISOString() }) {
  for (const order of orders) {
    const quote = order.quote
    state.cash -= order.cost
    state.positions.push({
      code: quote.code,
      name: quote.name || '',
      buyDate: date,
      buyPrice: quote.price,
      shares: order.shares,
      cost: order.cost,
    })
    pushHistory(state, {
      at: timestamp,
      action: 'buy',
      code: quote.code,
      name: quote.name || '',
      shares: order.shares,
      price: quote.price,
      amount: order.cost,
    })
  }
  state.lastRuns = state.lastRuns || {}
  state.lastRuns.buy = timestamp
}

export function applySell(
  state,
  position,
  { price, date, rule, timestamp = new Date().toISOString() }
) {
  const index = state.positions.findIndex((item) => item.code === position.code)
  if (index < 0) throw new Error(`持仓中找不到 ${position.code}`)
  state.positions.splice(index, 1)
  const amount = price * position.shares
  state.cash += amount
  pushHistory(state, {
    at: timestamp,
    action: 'sell',
    code: position.code,
    name: position.name || '',
    shares: position.shares,
    price,
    amount,
    buyDate: position.buyDate,
    buyPrice: position.buyPrice,
    rule,
    date,
  })
  state.lastRuns = state.lastRuns || {}
  state.lastRuns.sell = timestamp
  return amount
}

export function acquireLock({ file = CONFIG.paths.lock, staleMs = 4 * 60 * 60 * 1000 } = {}) {
  ensureDir(path.dirname(file))
  const tryAcquire = () => {
    const fd = fs.openSync(file, 'wx')
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    fs.closeSync(fd)
  }

  try {
    tryAcquire()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let stale = false
    try {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'))
      const age = Date.now() - new Date(previous.startedAt).getTime()
      stale = !Number.isFinite(age) || age > staleMs || !isPidAlive(previous.pid)
    } catch {
      stale = true
    }
    if (!stale) {
      throw new LockError(`已有另一个 overnight 进程在运行（锁文件 ${file}）`)
    }
    fs.rmSync(file, { force: true })
    tryAcquire()
  }

  const cleanup = () => {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      // ignore release errors
    }
  }
  const onExit = () => cleanup()
  const onSigint = () => {
    cleanup()
    process.exit(130)
  }
  process.once('exit', onExit)
  process.once('SIGINT', onSigint)

  return () => {
    process.removeListener('exit', onExit)
    process.removeListener('SIGINT', onSigint)
    cleanup()
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export function positionStatus(state, today) {
  const positions = Array.isArray(state.positions) ? state.positions : []
  const sellable = positions.filter((position) => position.buyDate < today)
  const frozen = positions.filter((position) => position.buyDate >= today)
  return {
    cash: state.cash,
    total: positions.length,
    sellable,
    frozen,
  }
}

export function formatPositionStatus(status) {
  const lines = [
    `现金: ${Number(status.cash).toFixed(2)}`,
    `持仓: ${status.total} 只（可卖 ${status.sellable.length}，T+1 不可卖 ${status.frozen.length}）`,
  ]
  if (!status.total) lines.push('  当前空仓')
  for (const position of status.sellable) {
    lines.push(
      `  可卖: ${position.code} ${position.name || ''} ${position.shares} 股，买入日 ${position.buyDate}`
    )
  }
  for (const position of status.frozen) {
    lines.push(
      `  T+1 不可卖: ${position.code} ${position.name || ''} ${position.shares} 股，买入日 ${position.buyDate}`
    )
  }
  return lines.join('\n')
}

export function readUniverse(file = CONFIG.paths.universe) {
  if (!fs.existsSync(file)) {
    throw new Error(`股票池文件不存在: ${file}，请先运行 refresh-universe`)
  }
  const codes = []
  const seen = new Set()
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const code = normalizeCode(text)
    if (!seen.has(code)) {
      seen.add(code)
      codes.push(code)
    }
  }
  if (!codes.length) throw new Error(`股票池文件为空: ${file}`)
  return codes
}

export function writeUniverse(codes, { file = CONFIG.paths.universe, source = '' } = {}) {
  const unique = [...new Set(codes.map(normalizeCode))].sort()
  const header = [
    '# 一夜持股主板代码表',
    `# 生成时间: ${new Date().toISOString()}`,
    source ? `# 来源: ${source}` : null,
    '# 格式: 每行一个带市场前缀的代码; # 开头为注释',
    '',
  ]
    .filter((line) => line != null)
    .join('\n')
  ensureDir(path.dirname(file))
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, header + unique.join('\n') + '\n')
  fs.renameSync(tmp, file)
  return unique
}
