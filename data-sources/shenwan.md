# 申万行业分类数据源参考

申万研究发布的行业分类变迁史，用于消除**行业前视偏差**：做历史研究时不能用今天的行业归属去套过去。公开 XLS、零鉴权。

> 本文件整理自 `a-stock-data` V3.10.2，数据于 2026-08 实测。

## 1. 数据文件

```text
GET https://www.swsresearch.com/swindex/pdf/SwClass2021/StockClassifyUse_stock.xls
```

- 公开 XLS，一次请求约几十 KB；用 pandas `read_excel` 解析。
- 实测 2026-08-19：12,893 行 / 5,905 只标的 / 38 个一级行业 / 194 个二级 / 553 个三级。
- 每只股票每次行业调整一行。

## 2. 字段

| 原列名     | 含义                 |
| ---------- | -------------------- |
| `股票代码` | 6 位代码             |
| `计入日期` | 该行业归属的生效日   |
| `行业代码` | 申万行业代码（6 位） |
| `更新日期` | 记录更新日           |

行业代码需要补成规范 6 位：

- 一级：`industry_code[:2] + "0000"`，如 `480000`
- 二级：`industry_code[:4] + "00"`，如 `480300`
- 三级：原 6 位

## 3. 按时点取行业

```python
def sw_industry_as_of(df, code, as_of):
    code = str(code).zfill(6)
    sub = df[(df["code"] == code) & (df["start_date"] <= as_of)]
    if sub.empty:
        return None
    row = sub.iloc[-1]
    return {
        "code": code,
        "as_of": as_of,
        "industry_code": row["industry_code"],
        "l1_code": row["l1_code"],
        "l2_code": row["l2_code"],
        "since": row["start_date"].strftime("%Y-%m-%d"),
    }
```

回测时每个调仓日调用一次，取「不晚于该日的最后一次调整」，不要用一份当前分类贯穿全程。

## 4. 坑位

- 申万官方只发布**代码**，不发布中文名；中文名称表未公开。东财/通达信的行业名与申万分类体系不同，不能直接套。
- 站点 SSL 偶发握手失败；先升级 `certifi` 或检查代理，不要静默跳过。
- 文件表头/列名可能变化；缺列时报错，不要返回空表。
- 该文件是当前可见的变更记录，不是历史快照；极早期数据可能不完整。
- 北交所标的在申万分类中的覆盖依文件而定，使用前先检查该代码是否存在。

## 5. 使用建议

- 行业轮动/历史研究：用 `sw_industry_as_of()` 取当时归属，避免前视偏差。
- 当日行业排名/资金流：用东财 `clist`（[eastmoney.md](./eastmoney.md)），更及时。
- 需要中文行业名时，自行维护一份代码→名称映射；不要用东财行业名直接替换申万代码。
