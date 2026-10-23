# 一夜持股策略脚本

> 项目级说明、策略清单和新增策略约定见 [../../README.md](../../README.md)。

按 `../../strategies/一夜持股.md` 实现的零依赖 Node.js 模拟盘脚本：尾盘选股、本地模拟持仓、T+1 次日卖出，输出策略规定的裸 JSON。

## 要求

- Node.js 24+（需要 `fetch`、`AbortSignal.timeout`、`TextDecoder('gbk')`）
- 无第三方依赖

## 快速开始

```bash
# 查看状态（首次 buy/sell 时自动初始化 20 万模拟资金）
npm run overnight:status

# 尾盘选股（14:30–14:57 运行；--dry-run 不落账）
npm run overnight:buy -- --dry-run

# 次日早盘卖出（默认 watch 到 11:30；--once 只评估一次）
npm run overnight:sell -- --once --dry-run

# 每笔卖出立即输出一条 JSON（JSONL），适合外部执行器即时消费
npm run overnight:sell -- --stream

# 按当前时间自动分派（09:30–11:30 卖出，14:30–14:57 买入）
npm run overnight:run
```

测试与排查：

```bash
npm run test:overnight
npm run overnight:probe -- sh600519
npm run overnight:probe -- sh600519 --ticks
```

`--force` 会跳过交易日和时间窗口校验，只用于非交易时段测试：

```bash
npm run overnight:buy -- --dry-run --force --codes sh600519,sz000001
```

其他参数：`--verbose` 输出调试日志；`--pretty` 让 stdout 的 JSON 缩进；`--cash N` 在首次 buy/sell 时指定初始资金。

## 股票池

`scripts/overnight/universe.txt` 是主板代码表，每行一个带市场前缀的代码（如 `sh600519`），当前包含 3352 只主板代码。

需要更新时：

```bash
# 默认读取项目内 universe.txt，做校验/去重/排序后原地更新
npm run overnight:refresh

# 或从外部 JSON / 文本代码表刷新（显式传 --from）
npm run overnight:refresh -- --from C:/path/to/codes.json
```

默认刷新是**原地规范化**，不会从外部拉取新代码；需要新增/删除股票时，手工编辑 `universe.txt` 后再执行一次，或从外部代码表用 `--from` 覆盖。运行时只读 `universe.txt`，不依赖外部项目或东财接口。

## 数据源

接口与字段细节见 [data-sources/tencent.md](../../data-sources/tencent.md)。

- 腾讯实时行情：现价、昨收、涨幅、量比、换手率、总市值、涨停/跌停价、VWAP（字段 51）
- 腾讯分时 `minute/query`：逐分钟价格、累计成交量、累计成交额；用于计算 VWAP 和分时条件
- 腾讯日线 / m1 K 线：MA5/10/20、近三日量能、14:00–14:30 高低点
- 腾讯逐笔：最终 1~3 只候选的 VWAP 复核
- 深交所交易日历：判断交易日；失败时回退到 weekday 判断，并在日志中标注

不调用东财；ST/退市整理用名称含 `ST` / `退` 近似过滤，停牌用腾讯 `is_stale` 与行情时间判断。

## 状态与输出

- 状态：`data/state/overnight.json`（已加入 `.gitignore`，不会提交）
- 日志：`data/logs/overnight-YYYY-MM-DD.log`（`*.log*` 已忽略）
- 初始资金：默认 200,000；首次 buy/sell 时可用 `--cash` 指定。已有状态不会被覆盖。
- 买入/卖出命令默认 stdout 只有裸 JSON；日志写 stderr。`sell --stream` 时每笔卖出输出一条 JSON（JSONL）。`status` / `probe` / `refresh-universe` 输出人类可读文本。
- 卖出前会检查仓位：当前空仓或持仓全部为 T+1 不可卖时，直接结束卖出操作，并在 stderr 打印现金、持仓数量、可卖/不可卖明细；stdout 仍输出空 JSON。
- 模拟成交按当前价成交，不计手续费和滑点；不接真实券商。

## 定时运行（Windows 任务计划程序示例）

在“任务计划程序”中创建两个触发器，程序填 `node`，参数填：

```text
C:\Users\27521\Documents\VScode\a-stock-pick\scripts\overnight\cli.mjs run
```

- 交易日 14:30：买入扫描
- 交易日 09:30：卖出监控（有可卖持仓时轮询到 11:30；空仓立即退出）

脚本会读取深交所日历，非交易日自动退出。建议把 stdout 重定向到文件，便于外部执行器读取 JSON；使用 `--stream` 时为 JSONL。

## 注意事项

- 策略条件很严格：涨幅 3%~5%、量比 >1、换手率 5%~10%、总市值 50~200 亿、近三日放量、均线多头、全天在 VWAP 上方、强于指数、14:00–14:30 创新高且回踩不破；没有候选就空仓。
- 如果 14:30 仍有隔夜持仓，`buy` 会拒绝买入；请先在次日卖出窗口执行 `sell`，或用 `sell --force` 手动处理。
- `sell` 默认每 60 秒轮询一次，可用 `--poll 30` 调整。
- 行情时间超过 15 分钟（卖出侧 10 分钟）视为停牌/异常：买入跳过，卖出顺延。
- `sell --stream` 每笔卖出立即输出一条 JSON（JSONL）；没有卖出时在结束时输出空 JSON。
- 尾盘扫描约 3352 只股票，通常需要 10~20 秒；逐笔复核每只约 20~30 秒，只对最终候选执行。
- `--force` 下买入会用收盘后的最新数据模拟 14:30 条件；卖出仍会检查行情时间，收盘后可能因行情滞后而顺延。结果仅供链路测试，不代表真实尾盘信号。
- 腾讯接口字段或格式变化时会明确报错，不会把缺失数据当 0。
- 本脚本仅用于模拟盘，不构成投资建议。
