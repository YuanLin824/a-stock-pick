# iwencai 数据源参考

iwencai（问财）的唯一价值是**自然语言语义搜索**：例如「人形机器人 行星滚柱丝杠 2026」这类跨主题检索，东财/新浪的按标的接口做不到。需要 API Key。

> 本文件整理自 `a-stock-data` V3.10.2，端点于 2026-09 实测。

## 1. 鉴权与环境变量

```bash
export IWENCAI_API_KEY="your_key_here"
export IWENCAI_BASE_URL="https://openapi.iwencai.com"
```

申请地址：`https://www.iwencai.com/skillhub`（注册后安装 SkillHub CLI，再安装 `report-search` 技能获取 Key）。

每次请求必须带：

```text
Authorization: Bearer <IWENCAI_API_KEY>
Content-Type: application/json
X-Claw-Call-Type: normal
X-Claw-Skill-Id: report-search
X-Claw-Skill-Version: 2.0.0
X-Claw-Plugin-Id: none
X-Claw-Plugin-Version: none
X-Claw-Trace-Id: <32 字节随机 hex>
```

缺少 X-Claw 头会返回 401。

## 2. 语义搜索

```text
POST https://openapi.iwencai.com/v1/comprehensive/search
Content-Type: application/json

{
  "channels": ["report"],
  "app_id": "AIME_SKILL",
  "query": "人形机器人 行星滚柱丝杠 2026",
  "size": 50
}
```

- `channels`：`report`（研报）/ `announcement`（公告）/ `news`（新闻）。
- `size` 默认 10，实测可调到 50（隐藏参数）。
- 响应 `data` 为文章数组；`status_code != 0` 表示业务错误。
- 同一 `uid` 可能返回多个段落，建议按 `uid` 去重，保留 `score` 最高的一条。

## 3. 结构化 NL 查询

```text
POST https://openapi.iwencai.com/v1/query2data
Content-Type: application/json

{
  "query": "贵州茅台 ROE",
  "page": "1",
  "limit": "50",
  "is_cache": "1",
  "expand_index": "true"
}
```

返回 `datas`，适合把自然语言条件转成结构化字段。分页从 1 开始。

## 4. 使用建议

- 只在需要**主题/语义检索**时用 iwencai；按标的搜研报走东财 reportapi 更稳定。
- 需要 Key，不适合放进无人值守的定时任务，除非 Key 已配置在环境中。
- 返回的 `extra` 可能是 JSON 字符串，需二次 `JSON.parse`。
- 结果要按 `publish_date`、`score` 去重排序；不要把摘要当全文引用。
- 请求失败时区分 HTTP 错误与 `status_code` 业务错误，不要把空结果当「没有研报」。
