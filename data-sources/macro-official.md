# 宏观与利率数据源参考

覆盖人民银行、国家统计局、中债、中国货币网，以及东财 LPR、华尔街见闻全球宏观日历。全部零鉴权、官方源为主。

> 本文件整理自 `a-stock-data` V3.10.2，数据于 2026-08 至 2026-09 实测。
> 这些是**月频/日频**数据，不要当日频交易信号用；发布时点固定（社融次月中旬、PMI 月末）。

## 1. 人民银行 — 社会融资规模增量

### 1.1 链路

```text
索引页：https://www.pbc.gov.cn/diaochatongjisi/116219/116319/index.html
  → 「XXXX年统计数据」
  → 年份页的「社会融资规模」专题
  → 专题页的 .xls / .xlsx 附件
```

三级跳中任何一级结构变化都应报错，不静默返回空。

### 1.2 字段与口径

表头为「中英双行 + 单位说明」，用第一列「月份」定位数据起点。12 列：

| 列                                | 含义                   |
| --------------------------------- | ---------------------- |
| `month`                           | 月份（YYYY-MM）        |
| `afre_total`                      | 社会融资规模增量       |
| `rmb_loans`                       | 人民币贷款             |
| `fx_loans`                        | 外币贷款               |
| `entrusted_loans`                 | 委托贷款               |
| `trust_loans`                     | 信托贷款               |
| `undiscounted_bankers_acceptance` | 未贴现银行承兑汇票     |
| `corporate_bonds`                 | 企业债券               |
| `government_bonds`                | 政府债券               |
| `equity_financing`                | 非金融企业境内股票融资 |
| `abs_by_depository`               | 存款类金融机构 ABS     |
| `loans_written_off`               | 贷款核销               |

- 单位：亿元。
- **仅支持 2021 年起**。2020 及更早是旧版式（表头与项目名合并、附表带历史区），传入会抛错而不是返回可疑数据。
- 未发布月份整行为空，必须丢弃；否则调用方会把 12 行当 12 个月真数据。

## 2. 国家统计局 — PMI

```text
索引页：https://www.stats.gov.cn/sj/zxfb/
  → 最新「采购经理指数」文章
```

- 正文是全角括号且括号内可能带空格（如 `（ PMI ）为 49.2%`）；解析前把空白整个删掉，只压成单空格会匹配不到。
- 返回：制造业 PMI、非制造业商务活动指数、综合 PMI 产出指数；以及大型/中型/小型企业 PMI。
- 50 为荣枯线；连续两月同向才算趋势。
- 三个主指标解析不到必须报错，不能返回一串 None。
- 大中小型企业分档措辞有过三种版式，解析时逐层回退；分档字段解析不到可为 None。

## 3. 中债 — 收益率曲线

```text
GET https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery
    ?startDate=2026-01-01&endDate=2026-09-18
    &gjqx=0&qxId=ycqx&locale=cn_ZH
```

`qxId` 取值：

| 曲线               | qxId         |
| ------------------ | ------------ |
| 一次取三条         | `ycqx`       |
| 国债               | `hzsylqx`    |
| 商业银行普通债 AAA | `syyhsylqx`  |
| 中短期票据 AAA     | `zdqpjsylqx` |

- 返回 8 档期限：3 月、6 月、1 年、3 年、5 年、7 年、10 年、30 年；单位 %。
- 中短期票据没有 30 年，该列为 None。
- 官网单次查询超过 1 年会静默返回 0 行；按 360 天切片。
- 三条曲线起点不同：国债 2006-03-01、中短票 2006-12-25、商业银行 2009-12-24。
- 中债不公布债券市场交易日历，整天缺失无法判定；只有整段切片 7 天以上 0 行才报错。

## 4. 中国货币网 — 回购定盘利率

```text
GET https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/frr-chrt.csv   # FR
GET https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/fdr-chrt.csv   # FDR
Referer: https://www.chinamoney.com.cn/chinese/bkfrr/
```

- CSV 每行 9 列：日期 + 5 个空列 + 隔夜 + 7 天 + 14 天。
- `FR`：全市场回购定盘利率 FR001/FR007/FR014，约近 3 年。
- `FDR`：银银间回购定盘利率 FDR001/FDR007/FDR014，约近 1 年。
- 单位 %；整行为空（只有日期、利率全空）要报错，不能返回一列 None。
- 中间 5 列必须为空；不为空说明格式变了。

## 5. LPR（东财）

```text
GET https://datacenter-web.eastmoney.com/api/data/v1/get
    ?reportName=RPTA_WEB_RATE&columns=TRADE_DATE,LPR1Y,LPR5Y
    &pageNumber=1&pageSize=500&sortColumns=TRADE_DATE&sortTypes=1&source=WEB&client=WEB
```

- 2013-10 至 2019-08 是旧机制逐日 1 年期 LPR，`LPR5Y` 为 None；2019-08-20 起 5 年期品种设立。
- 同一报表混有旧贷款基准利率调整行（`LPR1Y` 为空），需剔除。
- 单位 %。

## 6. 全球宏观日历（华尔街见闻）

```text
GET https://api-one-wscn.awtmt.com/apiv1/finance/macrodatas
    ?start=<unix 秒>&end=<unix 秒>
```

- 单次只允许一周；区间含两端最多 92 天，按 7 天切片。
- 返回 `data.items[]`：`id`、`public_date`（Unix 秒，北京时间）、`country`、`title`、`calendar_type`（`FD` 数据 / `FE` 事件）、`importance`（1–4，越大越重要）、`actual`、`forecast`、`previous`、`revised`、`unit`、`period`。
- 已开始的整周 0 条视为接口异常；单日、周末或三周以后的日期可能确实为空。
- `importance` 只接受 1–4；`actual` 的 0 与空串要区分。

## 7. 使用建议

- 社融、PMI 是月频，适合做中期背景，不适合当日选股。
- 收益率曲线/回购利率看资金面松紧；中债单次查询不要超过 1 年。
- LPR 用东财接口即可；如需官方原文，再回人民银行/货币网核对。
- 宏观日历适合事件驱动策略的排期，注意北京时间与发布延迟。
