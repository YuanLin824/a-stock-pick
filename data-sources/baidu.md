# 百度股市通数据源参考

百度股市通的独有能力是**日 K 线自带 MA5/MA10/MA20**，适合快速核对均线，不必本地计算。HTTP、零鉴权、风险低。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-05 前后实测。

## 1. 带均线的日 K

```text
GET https://finance.pae.baidu.com/selfselect/getstockquotation
    ?all=1&isIndex=false&isBk=false&isBlock=false&isFutures=false&isStock=true
    &newFormat=1&group=quotation_kline_ab&finClientType=pc
    &code=600519&start_time=&ktype=1
```

请求头：

```text
User-Agent: Mozilla/5.0
Accept: application/vnd.finance-web.v1+json
Origin: https://gushitong.baidu.com
Referer: https://gushitong.baidu.com/
```

响应关键路径：

```text
Result.newMarketData.keys      # 字段名数组
Result.newMarketData.marketData # 分号分隔的行
```

`keys` 通常包含：

```text
time, open, close, high, low, volume, amount,
ma5avgprice, ma10avgprice, ma20avgprice, ...
```

每行按 `keys` 的顺序对应，解析时不要硬编码列号。

## 2. 坑位

- `ResultCode` 的类型不稳定：有时是数字 `0`，有时是字符串 `"0"`；必须用 `str(...) == "0"` 比较。
- 只有日 K + 均线；实时行情、分钟线、逐笔仍用腾讯。
- 接口是百度内部页面接口，字段可能变化；解析失败应显式报错。
- 请求频率不宜过高；批量核对均线时优先用腾讯日线 + 本地计算，百度只做抽查。
