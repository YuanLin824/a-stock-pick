# 巨潮资讯（cninfo）数据源参考

巨潮是公告全文检索和深市互动易问答的来源。HTTP、零鉴权；公告需要动态查 `orgId`，互动易只覆盖深市。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-09 实测。

## 1. 公告全文检索

### 1.1 股票 → orgId 映射

```text
GET http://www.cninfo.com.cn/new/data/szse_stock.json
```

返回 `stockList[]`，每项含 `code`、`orgId`。首次调用拉取一次并做模块级缓存即可。

`orgId` **不是统一格式**：

- 600519 → `gssh0600519`（老格式 `gs{prefix}0{code}`）
- 601318 → `9900002221`
- 601398 → `jjxt0000019`
- 688017 → `9900041602`

硬编码 `gssx0{code}` 会让大量 601xxx 股票返回 `totalAnnouncement=0`。查不到映射时才回退到 `gs{prefix}0{code}`。

### 1.2 公告查询

```text
POST https://www.cninfo.com.cn/new/hisAnnouncement/query
Content-Type: application/x-www-form-urlencoded
Referer: https://www.cninfo.com.cn/new/disclosure
Origin: https://www.cninfo.com.cn

stock=<code>,<orgId>&tabName=fulltext&pageSize=30&pageNum=1
&column=&category=&plate=&seDate=&searchkey=&secid=&sortName=&sortType=&isHLtitle=true
```

响应 `announcements[]`：

| 字段                   | 说明                               |
| ---------------------- | ---------------------------------- |
| `announcementTitle`    | 标题                               |
| `announcementTypeName` | 类型                               |
| `announcementTime`     | Unix 毫秒时间戳，需转 `YYYY-MM-DD` |
| `announcementId`       | 公告 ID                            |

详情页：`https://www.cninfo.com.cn/new/disclosure/detail?annoId=<announcementId>`。

## 2. 互动易问答（深市）

```text
POST https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo
  keyWord=<code>

POST https://irm.cninfo.com.cn/newircs/company/question
  ?_t=1&stockcode=<code>&orgId=<secid>&pageSize=30&pageNum=1
  &keyWord=&startDay=&endDay=
```

- 第一步用代码查 `secid`（即 orgId）；第二步参数必须放在 **query string**，POST body 为空，否则 HTTP 400。
- 返回 `rows[]`：`stockCode`、`companyShortName`、`mainContent`（提问）、`attachedContent`（回复，未回复为 null）、`attachedAuthor`、`pubDate`（毫秒时间戳）。
- **只覆盖深市**；沪市公司实测 600519 / 600000 / 688981 均返回 0 条，沪市请用 [official-exchanges.md](./official-exchanges.md) 的上证e互动。
- 最新提问常未回复，`answer` 为 null 是正常情况。
- 请求失败时会打印 WARN 并返回空列表，与「确实没有问答」无法区分；批量使用时要看日志。

## 3. 使用建议

- 公告是巨潮的强项；PDF 直链在深交所官方公告接口里也可拿到（见 official-exchanges.md）。
- 公告查询的 `orgId` 必须动态获取；缓存映射表可以显著减少请求。
- 互动易只做深市；沪市走上证e互动，北交所两个平台都没有。
- 解析失败要区分「没有公告」与「接口结构变化」，不要静默返回空。
