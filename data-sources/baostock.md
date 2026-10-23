# baostock 数据源参考

baostock 是一个免注册的 TCP 数据客户端，强项是**日频历史估值**、**换手率**、**停牌/ST 标记**、**上市/退市日**。不支持北交所。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-08 实测。

## 1. 安装与会话

```bash
pip install baostock
```

```python
import baostock as bs

lg = bs.login()
if lg.error_code != '0':
    raise RuntimeError(f"{lg.error_code} {lg.error_msg}")
try:
    # 查询
    ...
finally:
    bs.logout()
```

必须用 `try/finally` 或上下文管理器保证 `logout()`；异常路径也要退出会话。

## 2. 估值历史

```python
rs = bs.query_history_k_data_plus(
    "sh.600519",
    "date,code,close,peTTM,pbMRQ,psTTM,pcfNcfTTM,turn,tradestatus,isST",
    start_date="2016-01-04",
    end_date="2026-08-18",
    frequency="d",
    adjustflag="3",     # 3=不复权；2=前复权；1=后复权
)
```

- 结果需逐行 `rs.next()` 读取，再转 DataFrame；`rs.error_code != "0"` 要报错。
- 字段：

| 字段          | 含义                                |
| ------------- | ----------------------------------- |
| `close`       | 收盘价                              |
| `peTTM`       | 市盈率 TTM                          |
| `pbMRQ`       | 市净率 MRQ                          |
| `psTTM`       | 市销率 TTM                          |
| `pcfNcfTTM`   | 市现率 TTM                          |
| `turn`        | 换手率（百分数，0.31 = 0.31%）      |
| `tradestatus` | `1` 正常交易 / `0` 停牌             |
| `isST`        | `1` ST/*ST / `0` 正常，历史逐日标记 |

- 估值序列可回溯至 2016 年；实测茅台 2016-01-04 至 2026-08-18 共 2581 行。
- 筹码分布需要的前复权 OHLC + 换手率可用 `adjustflag="2"` 一次取齐；停牌日应过滤。

## 3. 标的基本信息

```python
rs = bs.query_stock_basic(code="sh.600519")
```

返回：`code`、`code_name`、`ipoDate`（上市日）、`outDate`（退市日，在市为空）、`type`、`status`（1 上市 / 0 退市）。

这是少数能拿到**退市日期**的零鉴权源，配合腾讯 `is_stale` 可在筛选阶段剔除僵尸标的。

## 4. ST 名单兜底

```python
rs = bs.query_stock_basic(code_name="ST")
```

- 用名称模糊查询，约 300 条、2 秒；不带参数的全量查询实测会在服务端卡住。
- 过滤 `type == "1"`、`status == "1"`、`code_name` 含 `ST`。
- 只有沪深，没有北交所；没有价格。

## 5. 代码格式与限制

- 代码格式：`sh.600519`、`sz.000001`；创业板 `sz.300xxx`；科创板 `sh.688xxx`。
- **不支持北交所**：4/8/92/920 号段会被服务端拒绝，报 `10004011 股票代码未标识sh或sz`。应在登录前拦截并抛 `ValueError`。
- 已退市标的的除权除息三个源都缺；北交所标的做复权必然对不上，不是本客户端的问题。
- 返回的「空」与「接口错误」要分开：`error_code != 0` 是错误；查询成功但 0 行才是没有数据。

## 6. 使用建议

- 历史估值、ST 历史、退市日优先 baostock；当日估值快照用腾讯。
- 做筹码分布时用前复权价（`adjustflag="2"`），并过滤 `tradestatus == "0"`。
- 每次批量查询复用一次登录会话，不要每条记录都 login/logout。
- 北交所标的不要传给 baostock；用腾讯当日快照或交易所数据替代。
