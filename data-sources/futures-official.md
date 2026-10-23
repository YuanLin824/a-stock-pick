# 期货与大宗商品数据源参考

覆盖五家期货交易所官方日行情、期权、会员持仓排名，以及上金所现货日线。大商所官网有反爬，官方日行情未接入；大商所品种用新浪实时价与日 K。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-09 实测。
> 非交易日/未发布/品种未上市应抛「没有数据」，结构变化/日期不符/重复记录应抛错。

## 1. 来源与覆盖

| 交易所               | 简称  | 官方日行情     | 期权 | 持仓排名 | 实测起点                                    |
| -------------------- | ----- | -------------- | ---- | -------- | ------------------------------------------- |
| 上海期货交易所       | SHFE  | ✅             | ✅   | ✅       | 2002-01-07（2021 年及以前无成交额）         |
| 上海国际能源交易中心 | INE   | ✅             | ✅   | ✅       | 2018-03 开业；排名 2020-07 起               |
| 郑州商品交易所       | CZCE  | ✅             | ✅   | ✅       | 2015-09-21（更早是另一套格式）              |
| 中国金融期货交易所   | CFFEX | ✅             | ✅   | ✅       | 2010-04-16                                  |
| 广州期货交易所       | GFEX  | ✅             | ✅   | ❌       | 2022-12 开业                                |
| 大连商品交易所       | DCE   | ❌（反爬）     | —    | —        | 用新浪 `futures_kline` / `futures_realtime` |
| 上海黄金交易所       | SGE   | ✅（现货日线） | —    | —        | 2016-12                                     |

## 2. 官方日行情

### 2.1 上期所 / 上期能源

```text
期货日行情： https://www.shfe.com.cn/data/tradedata/future/dailydata/kx{YYYYMMDD}.dat
期权日行情： https://www.shfe.com.cn/data/tradedata/option/dailydata/kx{YYYYMMDD}.dat
持仓排名：   https://www.shfe.com.cn/data/tradedata/future/dailydata/pm{YYYYMMDD}.dat

上期能源同路径，域名换成 https://www.ine.cn
```

- 后缀是 `.dat`，实际是 JSON；非交易日 404。
- 期货行列表在 `o_curinstrument`；期权在 `o_curinstrument`，系列隐含波动率在 `o_cursigma`；排名在 `o_cursor`。
- 上期所文件里混有上期能源品种（原油、20 号胶等），需用能源中心同日的 ID 集合剔除，避免 SHFE/INE 重复。
- 期货品种 ID 以 `_f` 结尾（如 `cu_f`）；`sc_tas` 是 TAS 指令，不是独立合约。
- 价格字段为 0 表示无成交，统一转 None。
- 单位：价格元；成交量手；持仓手；成交额万元。

### 2.2 郑商所

```text
期货日行情： https://www.czce.com.cn/cn/DFSStaticFiles/Future/{YYYY}/{YYYYMMDD}/FutureDataDaily.txt
期权日行情： https://www.czce.com.cn/cn/DFSStaticFiles/Option/{YYYY}/{YYYYMMDD}/OptionDataDaily.txt
持仓排名：   https://www.czce.com.cn/cn/DFSStaticFiles/Future/{YYYY}/{YYYYMMDD}/FutureDataHolding.txt
```

- 竖线分隔文本；2017 年及以前是 GBK，之后是 UTF-8（可能带 BOM）。
- 表头别名：`品种月份`/`品种代码` → `合约代码`，`空盘量` → `持仓量`。
- 剔除「小计/总计/合计」行。
- 期权代码形如 `CF701MSC14400`，解析为系列、C/P、行权价。

### 2.3 中金所

```text
日行情 CSV： http://www.cffex.com.cn/fzjy/mrhq/{YYYYMM}/{DD}/{YYYYMMDD}_1.csv
日行情索引： http://www.cffex.com.cn/fzjy/mrhq/{YYYYMM}/{DD}/index.xml
持仓排名：   http://www.cffex.com.cn/sj/ccpm/{YYYYMM}/{DD}/{product}_1.csv
```

- CSV 编码 GBK；期货与期权在同一个文件。
- CSV **没有交易日列**；必须用同目录 `index.xml` 每行的 `tradingday` 核对，并逐合约比对成交量/收盘价/持仓量。
- 缺文件时 302 跳到错误页；不要当空数据。
- 持仓排名按品种 IF/IH/IC/IM/TS/TF/T/TL 各一个文件；当天已上市品种缺文件要报错，不返回部分品种。
- 中金所不公布期权 Delta/IV。
- 单位：价格元；成交量手；持仓手；成交额万元。

### 2.4 广期所

```text
POST http://www.gfex.com.cn/u/interfacesWebTiDayQuotes/loadList
Content-Type: application/x-www-form-urlencoded
Referer: http://www.gfex.com.cn/gfex/rihq/hqsj_tjsj.shtml

trade_date=20260918&trade_type=0    # 0=期货，1=期权
```

- 返回 `code=0` 为成功；`param` 回显请求参数，需核对 `trade_date` / `trade_type`。
- 非交易日返回空表（只剩合计行），不回退到最近交易日。
- 行字段：`variety`、`varietyOrder`、`delivMonth`、`open/high/low/close`、`clearPrice`、`lastClear`、`volumn`、`openInterest`、`diffI`、`turnover`；期权另有 `delta`、`impliedVolatility`。
- 无 `delivMonth` 的行是合计行，剔除。

### 2.5 上金所

```text
POST https://www.sge.com.cn/graph/Dailyhq
Content-Type: application/x-www-form-urlencoded
Referer: https://www.sge.com.cn/

instid=Au99.99
```

- 返回 `time[]`，每行 `[日期, 开, 收, 低, 高]`。
- 黄金单位元/克；白银元/千克。
- 无成交日交易所填 0，剔除；代码不存在时返回全 0，应报错。
- 少数日期收盘价略超出高低区间是原始数据如此，记录异常日期；大面积不成立才说明字段顺序变了。
- 品种：`Au99.99`、`Au(T+D)`、`mAu(T+D)`、`Ag(T+D)`、`Ag99.99`、`Pt99.95` 等。

## 3. 新浪补充（含大商所）

### 3.1 实时行情

```text
GET https://hq.sinajs.cn/list=nf_RB0,nf_M0,nf_IF0
Referer: https://finance.sina.com.cn/
```

- `RB0` 主力连续、`CU2610` 具体合约；带不带 `nf_` 前缀都行。
- 商品期货与中金所字段布局不同；中金所有昨收/涨跌停/买卖档，商品没有。
- 盘中是实时价；收盘后是当日收盘快照，结算价以交易所日行情为准。
- 大商所品种（M、I、L 等）只能用新浪实时价。

### 3.2 日 K

```text
GET https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_{code}=/
    InnerFuturesNewService.getDailyKLine?symbol={code}
Referer: https://finance.sina.com.cn/
```

- `{code}` 如 `RB0`、`M0`、`IF2612`；郑商所也写 4 位年月（`MA2601`）。
- 返回 JSONP；`null` 表示代码不存在或太老。
- 字段：`d` 日期、`o/h/l/c` 开高低收、`s` 结算价、`v` 成交量、`p` 持仓。
- 结算价可能为 0（中金所基本没有；主力连续早年缺得多），统一转 None。
- 具体合约只能取到约 2022 年起到期的；中金所主力连续只从 2017-01-17 起。
- 新浪每次返回全部历史（RB0 约 0.5MB），start/end 是本地筛选。

### 3.3 A50

```text
GET https://hq.sinajs.cn/list=hf_CHA50CFD
```

富时中国 A50 期指连续合约报价，盘前/夜盘看外资情绪。字段：最新、买、卖、高、低、时间、昨结、开、持仓、日期、名称。

## 4. 持仓排名

- 上期所/能源/郑商所/中金所提供会员成交量、持买单、持卖单前 20 名；广期所未接入。
- 上期所 `RANK` 1–20 为会员名次；999 是该合约合计，-1/0 是按会员类型汇总，剔除。
- 郑商所区分「合约」与「品种」两个层级；品种合计只有郑商所公布。
- 中金所按品种文件分开；已上市品种缺文件要报错。

## 5. 使用建议

- 期货日行情、期权、排名优先交易所官方；实时价与日 K 用新浪补大商所。
- 价格 0 统一视为无成交；不要拿 0 参与收益率/估值计算。
- 中金所 CSV 必须用 `index.xml` 核对交易日与逐合约字段。
- 郑商所注意 GBK/UTF-8 切换与表头别名。
- 上期所与能源中心数据有重叠，必须按能源中心 ID 剔除。
- 期权 Delta/IV：交易所公布值优先；中金所不公布，不要自行假设。
