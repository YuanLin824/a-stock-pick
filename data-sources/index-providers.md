# 指数数据源参考

中证指数与国证指数提供**指数成分、权重、指数估值**。全部公开文件、零鉴权。交易日历见 [official-exchanges.md](./official-exchanges.md) 的深交所接口。

> 本文件整理自 `a-stock-data` V3.10.2，数据于 2026-09 实测。
> 这些接口返回的是**最近公布的快照**，不是历史时点成分；做历史回测不能拿当前成分代替当时成分。

## 1. 中证指数（CSI）

| 数据     | 端点                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 成分股   | `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/cons/{code}cons.xls`               |
| 权重     | `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/{code}closeweight.xls` |
| 指数估值 | `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/{code}indicator.xls`     |

- `code` 必须是 6 位纯数字指数代码（如 `000300`、`000905`、`399006` 需确认 provider）。
- 成分/权重文件列：`日期Date`、`指数代码IndexCode`、`成份券代码ConstituentCode`、`成份券名称ConstituentName`、`交易所Exchange`；权重文件另有 `权重(%)weight`。
- 交易所映射：上海证券交易所 → `SH`，深圳 → `SZ`，北京 → `BJ`。
- `date` 列是**源文件日期**，不是抓取日；同一批成分与权重可能不同日，不能按行号拼接。
- 权重 `weight_percent=0.433` 表示 0.433%（百分数，不是小数）；权重合计应在 99–101 之间。
- 估值文件：两种股本口径 PE（`P/E1` 总股本、`P/E2` 计算用股本）和两种股息率（`D/P1`、`D/P2`）；**不含 PB**，不承诺全历史。

## 2. 国证指数（CNI）

```text
GET https://www.cnindex.com.cn/sample-detail/download-history?indexcode={code}
```

- 返回 Excel；列：`日期`、`样本代码`、`样本简称`、`权重（%）`。
- 当前文件是**月末快照**；文件名虽带 history，但实测只返回单个月末快照。
- 国证没有交易所列；按代码号段推断：6 开头 `SH`、0/3 开头 `SZ`、4/8/92 开头 `BJ`。
- 港股代码（如 `00700`）不能补成 `000700/SZ`；本端点只服务沪深北成分。
- 权重同样是百分数。

## 3. 推荐函数

| 函数                                       | 说明                                            |
| ------------------------------------------ | ----------------------------------------------- |
| `index_constituents(index_code, provider)` | 最近公布的成分快照；`provider` 为 `csi` / `cni` |
| `index_weights(index_code, provider)`      | 最近公布的权重；百分数                          |
| `index_valuation(index_code)`              | 仅中证；两种 PE、两种股息率，不含 PB            |
| `trading_calendar(year, month)`            | 深交所整月日历（见 official-exchanges.md）      |

## 4. 坑位

- 指数代码必须是 6 位纯数字；股票代码不能直接当指数查询。
- `provider` 必须显式指定 `csi` 或 `cni`；两者分类体系/文件格式不同。
- 成分与权重可能不同日；使用前先看 `date`，不要把月末权重标成今天。
- 中证/国证都**不提供历史时点成分**；历史回测要用当时公布的成分，当前快照只能做当前筛选。
- 权重范围为 0–100，合计 99–101；超出说明文件残缺或不是百分数口径。
- 估值文件只有中证；国证没有对应估值文件。
- 网络失败、结构变化、重复记录、日期不符都要显式报错，不伪装成空结果。
