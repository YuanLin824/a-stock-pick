# 交易所 / 官方机构数据源参考

覆盖上交所、深交所、北交所、港交所官方接口。官方源的最大价值是**权威、零鉴权、风控低**；代价是接口分散、字段口径不统一、历史深度有限。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-07 至 2026-09 实测。
> 使用前先确认：数据日期、单位、分页总数、是否只是当前快照。

## 1. 上交所（SSE）

### 1.1 融资融券明细

```text
GET https://query.sse.com.cn/marketdata/tradedata/queryMargin.do
    ?isPagination=true&tabType=mxtype&detailsDate=20260903
    &pageHelp.pageSize=5000&pageHelp.pageNo=1&pageHelp.beginPage=1
    &pageHelp.cacheSize=1&pageHelp.endPage=1
Referer: https://www.sse.com.cn/
```

- 返回 `pageHelp.data`，字段：`opDate`、`stockCode`、`securityAbbr`、`rzye`（融资余额，元）、`rzmre`（融资买入额，元）、`rqylje`（融券余额，元，可能为空）、`rqyl`（融券余量，股/份）、`rqmcl`（融券卖出量）。
- 必须核对 `pageHelp.total` 与返回条数；分页不完整不能当全市场。
- 单所数据不能标成「沪深全市场」；深交所发布进度可能不同。

### 1.2 ETF 份额

```text
GET https://query.sse.com.cn/commonQuery.do
    ?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L
    &STAT_DATE=2026-09-18&isPagination=true
    &pageHelp.pageSize=10000&pageHelp.pageNo=1&pageHelp.beginPage=1
    &pageHelp.cacheSize=1&pageHelp.endPage=1
Referer: https://www.sse.com.cn/
```

- 返回 `result[]`，字段：`STAT_DATE`、`SEC_CODE`、`SEC_NAME`、`ETF_TYPE`、`TOT_VOL`（万份）。
- 服务端每页最多返回 2000 条（即使请求 10000）；条数必须等于 `pageHelp.total`。
- 非交易日或尚未发布时为空，不能当「当天没有 ETF」。

### 1.3 龙虎榜全文

```text
GET https://query.sse.com.cn/infodisplay/showTradePublicFile.do
    ?jsonCallBack=cb&isPagination=false&dateTx=2026-07-10
Referer: https://www.sse.com.cn/disclosure/diclosure/public/
```

返回 JSONP，`fileContents` 是文本数组（含营业部席位）。适合在东财龙虎榜被封时做权威备胎。

### 1.4 五档快照

```text
GET https://yunhq.sse.com.cn:32041/v1/sh1/snap/{code}
```

盘中五档快照。字段与延迟未在 skill 中逐项标定；实时行情优先腾讯。

### 1.5 上证e互动（沪市问答）

```text
POST https://sns.sseinfo.com/allcompany.do
  code=0&order=2&areaId=0&page=<n>

GET https://sns.sseinfo.com/ajax/feeds.do
  type=11|10&pageSize=10&lastid=-1&show=1&page=<n>

POST https://sns.sseinfo.com/ajax/userfeeds.do
  typeCode=company&type=11|10&pageSize=10&uid=<uid>&page=<n>
```

- `type=11` 最新已回复；`type=10` 最新提问（含未回复，`answer` 为 None）。
- 只覆盖沪市（60/68/900 开头）；深市用 [cninfo.md](./cninfo.md) 的互动易。
- 公司列表按代码升序、每页约 32 家，首次查某公司要倍增 + 二分定位 `uid`，之后可缓存。
- 平台只开放近期问答（公司维度实测约近 1 个月）。
- 页面结构改版风险较高，解析失败要显式报错。

## 2. 深交所（SZSE）

### 2.1 交易日历

```text
GET https://www.szse.cn/api/report/exchange/onepersistenthour/monthList?month=2026-10
```

返回 `data[]`，字段 `jyrq`（YYYY-MM-DD）、`jybz`（`"1"` 交易 / `"0"` 休市）。当前项目用它判断交易日；失败时回退 weekday。

### 2.2 融资融券明细

```text
GET https://www.szse.cn/api/report/ShowReport
    ?SHOWTYPE=xlsx&CATALOGID=1837_xxpl&TABKEY=tab2&txtDate=2026-09-03
Referer: https://www.szse.cn/
```

Excel 字段：`证券代码`、`证券简称`、`融资余额(元)`、`融资买入额(元)`、`融券余额(元)`、`融券余量(股/份)`、`融券卖出量(股/份)`。

深交所不提供两种偿还字段（融资偿还额/融券偿还量），与东财字段不完全等价。

### 2.3 ETF 份额（当前快照）

```text
GET https://fund.szse.cn/api/report/ShowReport/data
    ?SHOWTYPE=JSON&CATALOGID=1000_lf&TABKEY=tab1&selectJjlb=ETF&PAGENO=1
Referer: https://fund.szse.cn/
```

- `metadata.subname` 是快照数据日期；`pagecount`、`recordcount` 用于分页/完整性核对。
- 深交所**只提供最新一天**，没有历史；日期不符要报错，不能回填历史。
- 字段：`sys_key`（代码/链接）、`jjjcurl`（名称）、`dqgm`（当前规模，万份）、`tzlb`、`glrmc`、`ssrq`。
- 深交所注明 T 日晚为预估值、T+1 早为确认值。

### 2.4 公告

```text
POST https://www.szse.cn/api/disc/announcement/annList
Content-Type: application/json
Referer: https://www.szse.cn/disclosure/listed/notice/index.html

{"channelCode":["listedNotice_disc"],"pageSize":20,"pageNum":1,"stock":["000858"]}
```

返回 `data[]`：`title`、`publishTime`、`attachPath`。PDF 直链：

```text
https://disc.static.szse.cn/download<attachPath>
```

### 2.5 龙虎榜

```text
GET https://www.szse.cn/api/report/ShowReport/data
    ?SHOWTYPE=JSON&CATALOGID=1842_xxpl&TABKEY=tab1
    &txtStart=2026-07-10&txtEnd=2026-07-10&random=0.9
Referer: https://www.szse.cn/disclosure/supervision/dealinfo/index.html
```

返回字段：`zqdm`（代码）、`zqjc`（名称）、`cjje`（成交金额）、`plyy`（上榜原因）。

### 2.6 五档快照

```text
GET https://www.szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code=000001
```

盘中快照，字段与延迟未逐项标定；实时行情优先腾讯。

## 3. 北交所（BSE）

### 3.1 当前行情 / 五档快照

```text
GET  https://www.bse.cn/nq/quotation.html          # 先建立匿名 Cookie 会话
POST https://www.bse.cn/nqhqController/nqhq_en.do
  page=0&type_en=["B"]&sortfield=hqzqdm&sorttype=asc&xxfcbj_en=[2]&zqdm=<可选代码>
Referer: https://www.bse.cn/nq/quotation.html
```

- 必须先访问页面获取匿名 Cookie；否则可能 302 或拒绝。
- 返回是 JSONP/JSON 包裹，`data[0].content` 为列表，`totalElements` 为总数；按页翻到总数。
- 字段：`hqzqdm` 代码、`hqzqjc` 名称、`hqjrkp` 开、`hqzgcj` 高、`hqzdcj` 低、`hqzjcj` 收、`hqzrsp` 昨收、`hqcjsl` 量、`hqcjje` 额、`hqjsrq` 日期、`hqgxsj` 时间、`hqsyl1` PE（官网口径未细分）、买卖五档 `hqbjw/hqbsl/hqsjw/hqssl` 1–5。
- **只提供当前快照，没有历史回填**；请求的交易日必须与每行 `hqjsrq` 一致。
- 北交所代码为 4/8/92 段；43/83/87 老码多数已迁至 920xxx。

## 4. 港交所（HKEX）

北向资金权威日统计（东财/同花顺北向断供时的备胎）：

```text
GET https://www.hkex.com.hk/chi/csm/DailyStat/data_tab_daily_{YYYYMMDD}c.js
```

返回当日北向成交额、额度余额、十大活跃股等。适合做日级权威核对；不是分钟级实时流向。

## 5. 使用建议

- 官方两融、ETF 份额、公告、龙虎榜适合做**权威核对/备胎**；实时行情仍优先腾讯。
- 所有官方接口都要核对**日期、分页总数、单位**；不要用当前快照回填历史。
- 上交所与深交所发布进度可能不同，不能把单所结果标成「沪深全市场」。
- 北交所、深交所 ETF 份额只有当前快照；需要历史就每日自行留存。
- 互动问答：深市走巨潮互动易，沪市走上证e互动；北交所两个平台都没有。
