# 同花顺免费端数据源参考

同花顺有几类**免 Key、零鉴权**的公开页面接口：热点归因、北向分钟流向、涨停揭秘、热榜、一致预期 EPS、F10 财务备份。它们和 [ths.md](./ths.md) 的「扶摇」官方 API 不是同一套：扶摇需要 API Key，本文件这些不需要。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-05 至 2026-09 实测。
> 免费端接口没有官方文档，字段可能变化；解析失败要显式报错。

## 1. 当日强势股 + 题材归因

```text
GET http://zx.10jqka.com.cn/event/api/getharden/
    date/2026-05-09/orderby/date/orderway/desc/charset/GBK/
```

- 仅需 `User-Agent`，不需要 cookie；实测约 73ms 返回约 125 只。
- 响应 `data[]`；`errocode != 0` 表示业务错误。
- 字段：

| 原字段           | 含义                          |
| ---------------- | ----------------------------- |
| `code`           | 6 位代码                      |
| `name`           | 名称                          |
| `reason`         | **题材归因**（人工运营 tags） |
| `zhangfu`        | 涨幅 %                        |
| `huanshou`       | 换手率 %                      |
| `chengjiaoe`     | 成交额（元）                  |
| `chengjiaoliang` | 成交量（股）                  |
| `ddejingliang`   | 大单净量                      |
| `close`          | 收盘价                        |
| `zhangdie`       | 涨跌额                        |
| `market`         | 沪 / 深 / 北                  |

## 2. 北向资金分钟流向

```text
GET https://data.hexin.cn/market/hsgtApi/method/dayChart/
Host: data.hexin.cn
Referer: https://data.hexin.cn/
```

返回 `time[]`、`hgt[]`（沪股通累计净买入，亿元）、`sgt[]`（深股通累计净买入，亿元）。实时接口只给当日分钟序列；历史可自行落 CSV 缓存，越跑越丰富。

> 深股通 `sgt` 自 2024-08 北向盘中披露收紧后不可靠：常只回传零星几个点、末值量级异常。`hgt` 可用于当日情绪，`sgt` 仅供参考；权威北向用 [official-exchanges.md](./official-exchanges.md) 的港交所日统计。

## 3. 涨停揭秘

```text
GET https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool
    ?page=1&limit=200&date=20260626
    &field=199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004
    &filter=HS,GEM2STAR&order_field=330324&order_type=0
```

- `field` 那串是同花顺内部字段 ID，照抄即可。
- 返回 `data.info[]`：`code`、`name`、`latest`、`change_rate`、`reason_type`（涨停原因题材）、`limit_up_type`（换手板/一字板/T字板）、`limit_up_suc_rate`、`open_num`、`order_amount`、`high_days`、`first_limit_up_time`、`is_again_limit`。
- `first_limit_up_time` 是 **Unix 秒时间戳**，需 `datetime.fromtimestamp`，不是 HHMMSS。
- `filter=HS,GEM2STAR` 控制板块范围（沪深主板 + 创业板 + 科创板）。

## 4. 热榜

```text
GET https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock
    ?stock_type=a&type=hour&list_type=normal
```

- `type`：`hour` / `day`。
- 返回 `data.stock_list[]`：`order`、`code`、`name`、`rate`（人气值）、`rise_and_fall`、`hot_rank_chg`、`tag.concept_tag`（概念标签）、`tag.popularity_tag`。
- 不需要 cookie；不要去打 `search.10jqka.com.cn` 的 NL 选股接口，那套有 hexin-v cookie 签名鉴权。

## 5. 一致预期 EPS

```text
GET https://basic.10jqka.com.cn/new/{code}/worth.html
Referer: https://basic.10jqka.com.cn/
```

- 页面是 **GBK**；用 HTML 表格解析。
- 找含「每股收益」或「均值」的表；列通常为：年度、预测机构数、最小值、均值、最大值。
- 「均值」即机构一致预期 EPS；预测机构数 < 3 时要谨慎。
- URL 只认纯 6 位代码，带 `sh`/`sz` 前缀会 404。

## 6. F10 财务备份

东财/新浪财务三表不可用时的同花顺备份：

```text
GET https://basic.10jqka.com.cn/api/stock/finance/{code}_debt.json     # 资产负债
GET https://basic.10jqka.com.cn/api/stock/finance/{code}_benefit.json  # 利润
GET https://basic.10jqka.com.cn/api/stock/finance/{code}_cash.json     # 现金流
```

仅需 UA；实测连续 5 次不封。字段为同花顺内部结构，使用前先打印确认。

## 7. K 线备用

```text
GET https://d.10jqka.com.cn/v6/line/hs_{code}/01/last.js
```

- `01` 日线 / `11` 周线 / `21` 月线；`30` / `60` 分钟线。
- 覆盖 2001 年至今；返回 JSONP，需剥壳。
- 只有 30/60 分钟，没有 1/5/15 分钟；分钟级优先腾讯。
- 腾讯 K 线三入口都被限流时，可作为日/周/月线的独立备胎。

## 8. 使用建议

- 热点归因是独家数据，适合做题材热度统计；不要把它当买卖信号。
- 北向 `sgt` 不可靠；权威数据用港交所日统计。
- 涨停揭秘的 `first_limit_up_time` 是秒级时间戳，容易误当 HHMMSS。
- 一致预期页面是 GBK HTML，解析失败要区分「无机构覆盖」与「页面改版」。
- 免费端没有 SLA；批量任务要限速，并对空结果做日志。
