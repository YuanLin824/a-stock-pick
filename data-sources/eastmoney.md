# 东方财富数据源参考

东方财富（下称「东财」）提供本项目所需的大部分**独有数据**：研报、龙虎榜、资金流、打板池、事件驱动、可转债等。全部 HTTP、零鉴权，但有 IP 级风控。

> 本文件整理自 `a-stock-data` V3.10.2，端点与字段于 2026-07 至 2026-10 实测。
> **原则：能用腾讯/交易所官方拿到的行情、K 线、财务，不要走东财。**

## 0. 统一请求与防封

所有东财请求建议走统一入口 `em_get()`：

- 串行，不并发；每次间隔 **≥1 秒 + 随机抖动**（`EM_MIN_INTERVAL=1.0`）。
- 复用 `requests.Session`（Keep-Alive），带浏览器 UA。
- 连接错误、429、5xx 指数退避重试；**403 不重试**（风控信号，重试会加重）。

社区实测封禁阈值：每秒 >5 次、单 IP 并发 ≥10、每分钟 ≥200 次、5 分钟 ≥300 次。被封表现为 `403` / `429` / 连接重置 / 空数据；临时封禁几分钟到几小时，极端案例可达 20+ 小时。

东财不同子域走不同 WAF：`push2` 被封不代表 `datacenter-web` 也封；反之亦然。降级时优先换子域或换备胎源。

### secid 规则

`push2` / `push2his` 使用 `secid`：

- 沪市（含 51x ETF、588x 科创 ETF、900x B 股）：`1.600519`
- 深市 / 北交所：`0.300750`、`0.920982`
- **不要用 `code.startswith("6")` 判市场**，否则 51x/588x/900x 会被错判成深市，接口返回 `data: null`。

### 通用坑位

- 接口对不存在/路由错误的 `secid` 返回 `"data": null`；`d.get("data", {})` 会拿到 `None`，需用 `d.get("data") or {}`。
- `diff` 有时是 list，有时是 dict（按序号为键），需 `list(diff.values())` 归一化。
- 北交所老号段 43/83/87 多数已迁至 920xxx；老码可能返回 0 条或僵尸数据，先按名称反查现行代码。
- 东财字段名/报表名会变；解析失败要显式报错，不把空结果当「没有数据」。

## 1. 数据中心 `datacenter-web.eastmoney.com`

```text
GET https://datacenter-web.eastmoney.com/api/data/v1/get
    ?reportName=<报表名>&columns=ALL&filter=<条件>&pageNumber=1&pageSize=500
    &sortColumns=<排序字段>&sortTypes=-1&source=WEB&client=WEB
```

### 常用报表

| 数据           | reportName                       | 关键字段 / 单位                                                                      |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| 个股龙虎榜     | `RPT_DAILYBILLBOARD_DETAILSNEW`  | `TRADE_DATE`、`EXPLANATION`、`BILLBOARD_NET_AMT`（元）、`TURNOVERRATE`（%）          |
| 龙虎榜买入席位 | `RPT_BILLBOARD_DAILYDETAILSBUY`  | `OPERATEDEPT_NAME`、`BUY`、`SELL`、`NET`（元）                                       |
| 龙虎榜卖出席位 | `RPT_BILLBOARD_DAILYDETAILSSELL` | 同上                                                                                 |
| 限售解禁       | `RPT_LIFT_STAGE`                 | `FREE_DATE`、`FREE_SHARES_TYPE`、`FREE_SHARES`、`ABLE_FREE_SHARES`、`FREE_RATIO`     |
| 融资融券明细   | `RPTA_WEB_RZRQ_GGMX`             | `DATE`、`RZYE`、`RZMRE`、`RZCHE`、`RQYE`、`RQMCL`、`RQCHL`、`RZRQYE`（元/股）        |
| 大宗交易       | `RPT_DATA_BLOCKTRADE`            | `TRADE_DATE`、`DEAL_PRICE`、`DEAL_VOLUME`、`DEAL_AMT`、`BUYER_NAME`、`SELLER_NAME`   |
| 股东户数       | `RPT_HOLDERNUMLATEST`            | `END_DATE`、`HOLDER_NUM`、`HOLDER_NUM_CHANGE`、`HOLDER_NUM_RATIO`、`AVG_FREE_SHARES` |
| 分红送转       | `RPT_SHAREBONUS_DET`             | `EX_DIVIDEND_DATE`、`PRETAX_BONUS_RMB`、`TRANSFER_RATIO`、`BONUS_RATIO`              |
| LPR            | `RPTA_WEB_RATE`                  | `TRADE_DATE`、`LPR1Y`、`LPR5Y`（%）                                                  |
| 业绩预告       | `RPT_PUBLIC_OP_NEWPREDICT`       | `NOTICE_DATE`、`REPORT_DATE`、`PREDICT_FINANCE`、金额上下限、同比上下限              |
| 机构调研       | `RPT_ORG_SURVEYNEW`              | `NOTICE_DATE`、`RECEIVE_START_DATE`、`SUM`（机构家数）、`RECEIVE_OBJECT`             |
| 股东增减持     | `RPT_SHARE_HOLDER_INCREASE`      | `HOLDER_NAME`、`DIRECTION`、`CHANGE_NUM_SYMBOL`、均价、占总股本/流通股比例           |
| 股票回购       | `RPTA_WEB_GETHGLIST_NEW`         | `REPURPROGRESS`、方案上下限、已回购股数/金额、`UPDATEDATE`                           |
| 股权质押       | `RPT_CSDC_LIST`                  | `TRADE_DATE`、`PLEDGE_RATIO`、`REPURCHASE_BALANCE`、`PLEDGE_MARKET_CAP`              |
| 新股申购       | `RPTA_APP_IPOAPPLY`              | `APPLY_DATE`、`ISSUE_PRICE`、`ISSUE_NUM`、`ONLINE_ISSUE_LWR`、`LISTING_DATE`         |
| 可转债         | `RPT_BOND_CB_LIST`               | 评级、规模、转股价、债价、正股价、转股价值、溢价率                                   |

### 分页与错误码

- 第 1 页返回 `code=9201` 表示「确实没有数据」，返回空列表。
- 第 2 页起返回 `9201`、空页、非末页不满页、`pages`/`count` 变化、最终条数与 `count` 不符，均视为结果不完整，应报错重试。
- 严格的翻页实现可参考 skill 的 `_em_datacenter_strict()`；`columns=ALL` 时字段可能随报表更新变化。

## 2. `push2` / `push2his` 实时与资金流

### 2.1 个股基本面

```text
GET https://push2.eastmoney.com/api/qt/stock/get
    ?secid=1.600519&fltt=2&invt=2
    &fields=f57,f58,f84,f85,f127,f116,f117,f189,f43
```

| 字段 | 含义                 |
| ---- | -------------------- |
| f57  | 代码                 |
| f58  | 名称                 |
| f84  | 总股本（股）         |
| f85  | 流通股（股）         |
| f127 | 行业                 |
| f116 | 总市值（元）         |
| f117 | 流通市值（元）       |
| f189 | 上市日期（YYYYMMDD） |
| f43  | 最新价               |

### 2.2 个股所属板块/概念

```text
GET https://push2.eastmoney.com/api/qt/slist/get
    ?secid=1.600519&spt=3&pi=0&pz=200&po=1&fltt=2&invt=2
    &fields=f12,f14,f3,f128
```

返回行业、概念、地域混合列表：`f12` 板块代码、`f14` 板块名、`f3` 涨跌幅、`f128` 龙头股。

### 2.3 行业/概念/地域排名与资金流

```text
GET https://push2.eastmoney.com/api/qt/clist/get
    ?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3
    &fs=m:90+t:2
    &fields=f2,f3,f4,f12,f13,f14,f104,f105,f128,f136,f140,f141,f207
```

`fs` 常用值：

- 行业：`m:90+t:2`
- 概念：`m:90+t:3`
- 地域：`m:90+t:1`
- 沪深风险警示板：`m:0+f:4,m:1+f:4`
- 北交所全表：`m:0+t:81+s:2048`

板块资金流（今日）追加字段 `f62`（主力净额）、`f184`（主力净占比）、`f66/f72/f78/f84`（超大/大/中/小单）；5 日/10 日使用 `f164/f165`、`f174/f175`。板块数可能超过单页上限（实测行业/概念各约 495 个），需要按 `total` 翻页。

### 2.4 个股资金流（分钟级）

```text
GET https://push2.eastmoney.com/api/qt/stock/fflow/kline/get
    ?secid=1.600519&klt=1&fields1=f1,f2,f3,f7
    &fields2=f51,f52,f53,f54,f55,f56,f57
```

`klt=1` 分钟级，`klt=101` 日级。`klines` 每行：时间、主力净流入、小单、中单、大单、超大单（元）。

> 个股资金流接口**不覆盖 ETF**；即使 secid 正确，510300/588000 也可能返回 0 条。

### 2.5 个股资金流（120 日）

```text
GET https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get
    ?secid=1.600519&lmt=120
    &fields1=f1,f2,f3,f7
    &fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65
```

返回日级主力/小/中/大/超大单净流入，单位元。

### 2.6 批量行情补全

```text
GET https://push2.eastmoney.com/api/qt/ulist.np/get
    ?ut=f057cbcbce2a86e2866ab8877db1d059&fltt=2&invt=2
    &fields=f14,f3,f12,f2&secids=1.600519,0.000001
```

用于东财人气榜等只给代码的场景，补名称/价格/涨跌幅。

## 3. 打板池 `push2ex.eastmoney.com`

固定参数：`ut=7eea3edcaed734bea9cbfc24409ed989`、`dpt=wz.ztzt`、`Pageindex=0`、`pagesize=10000`、`date=YYYYMMDD`。

| 池         | 端点                 | 排序       | 关键字段                                                               |
| ---------- | -------------------- | ---------- | ---------------------------------------------------------------------- |
| 涨停池     | `getTopicZTPool`     | `fbt:asc`  | `lbc` 连板数、`fbt/lbt` 首/末封板时间、`fund` 封板资金、`zbc` 炸板次数 |
| 炸板池     | `getTopicZBPool`     | `fbt:asc`  | 涨停价、炸板次数、振幅、涨速                                           |
| 跌停池     | `getTopicDTPool`     | `fund:asc` | 封单资金、连续跌停天数、开板次数                                       |
| 昨日涨停池 | `getYesterdayZTPool` | `zs:desc`  | 昨日封板时间、昨日连板数、今日涨幅                                     |

- `price` / `limit_price` 原始值是 ×1000 整数，使用前 ÷1000。
- `date` 必须是交易日；非交易日 `data` 返回 `null`。
- 金额单位均为元。

## 4. 研报 `reportapi.eastmoney.com`

```text
GET https://reportapi.eastmoney.com/report/list
    ?industryCode=*&pageSize=100&industry=*&rating=*&ratingChange=*
    &beginTime=2000-01-01&endTime=2030-01-01
    &pageNo=1&qType=0&code=600519
```

- `qType=0` 个股研报；`qType=1` 行业研报。
- `code` 只认**纯 6 位数字**；传 `SH600519` 会返回 0 篇，需先归一化。
- 关键字段：`title`、`publishDate`、`orgSName`、`infoCode`、`predictThisYearEps`、`predictNextYearEps`、`predictNextTwoYearEps`、`emRatingName`、`indvInduName`。
- PDF：`https://pdf.dfcfw.com/pdf/H3_{infoCode}_1.pdf`，需带 `Referer: https://data.eastmoney.com/`。
- 行业码没有公开码表；先用 `industry_code="*"` 拉取，再从结果反查 `industryCode`。

## 5. 新闻与快讯

### 5.1 个股新闻

```text
GET https://search-api-web.eastmoney.com/search/jsonp
    ?cb=jQuery_news&param=<JSON>
```

`param` 内层为 `cmsArticleWebOld` 搜索，字段 `keyword`、`pageIndex`、`pageSize`。响应是 JSONP，需剥壳；文章列表在 `result.cmsArticleWebOld`，不是 `result.cmsArticleWebOld.list`。

### 5.2 全球 7×24 快讯

```text
GET https://np-weblist.eastmoney.com/comm/web/getFastNewsList
    ?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=50&req_trace=<uuid>
```

返回 `data.fastNewsList`，字段 `title`、`summary`、`showTime`。

### 5.3 公告备用（沪市）

巨潮公告不可用时的沪市备胎：

```text
GET https://np-anotice-stock.eastmoney.com/api/security/ann
    ?sr=-1&page_size=20&page_index=1&ann_type=A&client_source=web
    &stock_list=600519&f_node=0&s_node=0
```

返回 `data.list[]`：`title`、`notice_date`、`art_code`。PDF：

```text
https://pdf.dfcfw.com/pdf/H2_{art_code}_1.pdf
```

深市公告优先用深交所官方接口（见 [official-exchanges.md](./official-exchanges.md)）。

## 6. 人气榜与概念命中 `emappdata.eastmoney.com`

```text
POST https://emappdata.eastmoney.com/stockrank/getAllCurrentList
Content-Type: application/json

{"appId":"appId01","globalId":"786e4c21-70dc-435a-93bb-38","marketType":"","pageNo":1,"pageSize":50}
```

人气榜返回带前缀代码（`SZ000001` / `SH600519`），名称/价格需再用 `ulist.np` 补全。

```text
POST https://emappdata.eastmoney.com/stockrank/getHotStockRankList
Content-Type: application/json

{"appId":"appId01","globalId":"786e4c21-70dc-435a-93bb-38","srcSecurityCode":"SH600519"}
```

返回该股当前被归入的热门概念、概念 ID、命中热度。

## 7. 重点监控池 `mobappconfig.securities.eastmoney.com`

```text
GET https://mobappconfig.securities.eastmoney.com/emcfg/stock_monitor.json
```

零鉴权静态 JSON，字段：`STKCODE`、`STKNAME`、`MARKET`（`"1"` 沪 / `"0"` 深 / `"B"` 北交所）、`VALIDATESTARTDATE`、`VALIDATEENDDATE`、`LINK_URL`。`MARKET` 是三值且含字母，不要当 0/1 二值处理。

## 8. 日内异动池 `dycalchis.eastmoney.com`

固定 H5 参数（缺 `team` 会返回 `{"result":1001,"msg":"unknow team"}`）：

```text
team=h5&product=EastMoney&client=WAP&version=9001&name=WAP&user=123
```

| 端点                   | 用途                                   |
| ---------------------- | -------------------------------------- |
| `/price-anomaly/list`  | 严重异常波动明细                       |
| `/price-anomaly/count` | 按标的聚合的异动次数、现价、累计偏离值 |

`result != 0` 表示接口拒绝，不能当成「今天没异动」。`s` 为板块码（1 主板 / 4 创业板 / 6 科创板 / 8 北交所）；`e` 为异动规则码，需按规则表翻译。

## 9. 使用建议

- 东财的强项是**独有数据**：研报、龙虎榜、资金流、打板池、事件驱动、可转债、互动问答（沪市以外）。
- 行情/K 线/财务三表优先腾讯、新浪、交易所；不要在批量筛选里用东财拉全市场行情。
- 批量任务必须串行 + sleep；不要对东财开多线程/协程。
- 东财被封时，按 [README.md](./README.md) 的「按数据需求选源」切换备胎。
