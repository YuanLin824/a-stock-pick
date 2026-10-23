import { toOutputCode } from './tencent.mjs'

const RISK = '⚠️ 风险提示\n本内容由 AI 生成｜仅模拟盘｜不构成投资建议'
const MAX_DETAIL = 150

function chars(text) {
  return [...String(text)]
}

export function charLength(text) {
  return chars(text).length
}

function trimTo(text, max) {
  const list = chars(text)
  if (list.length <= max) return text
  return list.slice(0, Math.max(0, max - 1)).join('') + '…'
}

export function fitReasonDetail({ params, logic, plan }) {
  let detail = [`📊 参数\n${params}`, `📈 逻辑\n${logic}`, `🎯 计划\n${plan}`, RISK].join('\n\n')
  if (charLength(detail) <= MAX_DETAIL) return detail

  logic = trimTo(logic, 24)
  detail = [`📊 参数\n${params}`, `📈 逻辑\n${logic}`, `🎯 计划\n${plan}`, RISK].join('\n\n')
  if (charLength(detail) <= MAX_DETAIL) return detail

  plan = '按计划离场'
  detail = [`📊 参数\n${params}`, `📈 逻辑\n${logic}`, `🎯 计划\n${plan}`, RISK].join('\n\n')
  if (charLength(detail) <= MAX_DETAIL) return detail

  const current = charLength(detail)
  const over = current - MAX_DETAIL
  logic = trimTo(logic, Math.max(0, charLength(logic) - over))
  return [`📊 参数\n${params}`, `📈 逻辑\n${logic}`, `🎯 计划\n${plan}`, RISK].join('\n\n')
}

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '-'
  return Number(value).toFixed(digits)
}

export function emptyOutput() {
  return { operations: { sell_orders: [], buy_orders: [] } }
}

export function buildOutput({ sellOrders = [], buyOrders = [] } = {}) {
  return { operations: { sell_orders: sellOrders, buy_orders: buyOrders } }
}

export function buildBuyOrder({ candidate, shares, price }) {
  const quote = candidate.quote
  const code = toOutputCode(quote.code)
  const name = quote.name || ''
  const reason = '【一夜持股】尾盘强势 + 均线上方运行建仓'
  const params = `► ${code} ${name}｜买入（尾盘建仓）\n► ${shares} 股｜限价 ${fmt(price)}`
  const logic = `买入条件 1~10 全满足（涨幅 ${fmt(quote.changePct)}%、量比 ${fmt(
    quote.volRatio
  )}、换手 ${fmt(quote.turnoverPct)}%）`
  const plan = '持股 1 夜，次日按卖出规则离场'
  const reasonDetail = fitReasonDetail({ params, logic, plan })
  return {
    order_type: 0,
    type: 'open_position',
    stock_code: code,
    stock_name: name,
    order_volume: shares,
    price: Number(price.toFixed(2)),
    price_type: 0,
    reason,
    reason_detail: reasonDetail,
  }
}

const SELL_REASON = {
  1: { title: '【一夜持股】高开冲高，按计划止盈卖出', side: '止盈', logic: '高开走强，冲高止盈' },
  2: {
    title: '【一夜持股】高开走弱，按规则卖出',
    side: '走弱',
    logic: '高开走弱，跌破均价线/开盘价',
  },
  3: { title: '【一夜持股】平开冲高，按计划止盈', side: '止盈', logic: '平开走强，冲高止盈' },
  4: { title: '【一夜持股】平开走弱，直接卖出', side: '走弱', logic: '平开走弱，直接卖出' },
  5: { title: '【一夜持股】低开反抽，减亏离场', side: '减亏', logic: '低开反抽至均价线/昨收' },
  6: { title: '【一夜持股】低开走弱，开盘卖出', side: '走弱', logic: '低开走弱，开盘卖出' },
  deadline: { title: '【一夜持股】11:30 清仓离场', side: '清仓', logic: '最迟 11:30 清仓' },
}

export function buildSellOrder({ position, decision, price }) {
  const code = toOutputCode(position.code)
  const name = position.name || ''
  const meta = SELL_REASON[decision.rule] || SELL_REASON.deadline
  const reason = meta.title
  const priceLabel = decision.priceType === 1 ? '市价' : '限价'
  const params = `► ${code} ${name}｜卖出（${meta.side}）\n► ${position.shares} 股｜${priceLabel}（参考 ${fmt(
    price
  )}）`
  const logic =
    decision.rule === 'deadline'
      ? '按卖出规则：最迟 11:30 清仓'
      : `按卖出规则 ${decision.rule}：${meta.logic}`
  const plan = '清仓离场，盘后重新筛选'
  const reasonDetail = fitReasonDetail({ params, logic, plan })
  return {
    order_type: 1,
    type: decision.orderType,
    stock_code: code,
    stock_name: name,
    order_volume: position.shares,
    price: Number(price.toFixed(2)),
    price_type: decision.priceType,
    reason,
    reason_detail: reasonDetail,
  }
}
