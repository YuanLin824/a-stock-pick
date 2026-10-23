# a-stock-pick

用于研究、记录和实现多种 A 股选股策略的项目。

每个策略独立包含**策略规格文档、可执行脚本、单元测试和运行说明**；策略之间共享数据源约定和工程规范，但各自独立运行、独立维护状态。

> 本项目仅用于学习、研究和模拟盘，不接真实券商，不构成投资建议。

## 目录结构

```text
strategies/          # 策略规格文档，每个策略一份 Markdown
scripts/             # 策略实现，每个策略一个子目录
  overnight/         # 一夜持股
tests/               # 按策略划分的单元测试
data-sources/        # 外部数据源接口文档（腾讯、新浪、同花顺、东财、交易所等）
data/                # 运行时状态、日志、缓存（本地生成，不提交）
```

`data/` 下的状态和日志由脚本在运行时创建，已在 `.gitignore` 中忽略。

## 策略清单

| 策略     | 规格文档                                         | 实现                                     | 运行入口                | 状态           |
| -------- | ------------------------------------------------ | ---------------------------------------- | ----------------------- | -------------- |
| 一夜持股 | [strategies/一夜持股.md](strategies/一夜持股.md) | [scripts/overnight/](scripts/overnight/) | `npm run overnight:run` | 可用（模拟盘） |

后续新增策略时，在 `strategies/` 和 `scripts/` 下按同样结构追加，并更新本表。

## 快速开始

要求 Node.js 24+。策略脚本使用 Node 内置模块，**零第三方运行时依赖**；`npm install` 仅用于 husky、prettier、commitlint 等开发工具。

当前策略「一夜持股」：

```bash
# 查看模拟账户状态
npm run overnight:status

# 尾盘选股（14:30–14:57 运行；--dry-run 不落账）
npm run overnight:buy -- --dry-run

# 次日早盘卖出（默认 watch 到 11:30；--once 只评估一次）
npm run overnight:sell -- --once --dry-run

# 每笔卖出即时输出 JSON（JSONL）
npm run overnight:sell -- --stream

# 按当前时间自动分派：09:30–11:30 卖出，14:30–14:57 买入
npm run overnight:run

# 测试与排查
npm run test:overnight
npm run overnight:probe -- sh600519
npm run overnight:probe -- sh600519 --ticks
```

详细用法、参数和数据源说明见 [scripts/overnight/README.md](scripts/overnight/README.md)。

## 数据源

当前「一夜持股」策略使用：

- **腾讯**：实时行情、分时、日线/分钟 K 线、当日逐笔（接口与字段见 [data-sources/tencent.md](data-sources/tencent.md)）
- **深交所**：交易日历
- **本地代码表**：`scripts/overnight/universe.txt`，运行时只读该文件，不依赖其他项目

该策略不调用东财。股票池可通过 `npm run overnight:refresh` 在本地校验/去重/排序，或通过 `--from` 从外部代码表刷新。

数据源总览与选源建议见 [data-sources/README.md](data-sources/README.md)。除腾讯与深交所日历外，其余数据源当前策略尚未接入，主要供后续策略参考。

后续策略如使用其他数据源，在对应策略的 README 中说明，并在 `data-sources/` 留档。

## 状态与输出

- 模拟账户状态：`data/state/overnight.json`
- 运行日志：`data/logs/overnight-YYYY-MM-DD.log`
- 默认模拟资金 200,000；空仓或全部 T+1 不可卖时，卖出直接结束并打印仓位状态
- `buy` / `sell` / `run` 默认输出策略规定的裸 JSON；`sell --stream` 时每笔卖出输出一条 JSON（JSONL）
- 模拟成交按当前价成交，不计手续费和滑点；不接真实券商

## 新增策略约定

1. 在 `strategies/<策略名>.md` 写清参数、买入/卖出条件、输出契约和风险边界。
2. 在 `scripts/<策略名>/` 实现，入口为 `cli.mjs`；建议按数据层、指标层、策略层、账户层、输出层拆分。
3. 在 `tests/<策略名>.test.mjs` 写纯函数单元测试，使用 `node --test`。
4. 在 `package.json` 增加 `<策略名>:buy` / `:sell` / `:run` / `:status` / `test:<策略名>` 等命令。
5. 状态文件使用 `data/state/<策略名>.json`，日志使用 `data/logs/<策略名>-YYYY-MM-DD.log`，不要提交。
6. 更新本 README 的「策略清单」。
7. 数据源优先使用腾讯/交易所官方，遵守限速；新增数据源先在 `data-sources/` 留档。
8. 明确「模拟盘 / 实盘」边界，默认不接真实交易接口。

## 工程约定

- ESM `.mjs`，Node 24+，零第三方运行时依赖
- 时间统一按 `Asia/Shanghai` 处理
- A 股 T+1、100 股整手
- 代码格式由 Prettier 管理；提交信息使用 Conventional Commits（husky + commitlint）
- 所有策略条件必须可量化、可复现、可测试；不把缺失数据当 0，不使用未来数据

## 免责声明

本项目及其中所有策略、脚本、示例仅用于学习、研究和模拟盘验证，不构成任何投资建议，不承诺收益，不保证数据实时性或准确性。任何实盘使用风险由使用者自行承担。
