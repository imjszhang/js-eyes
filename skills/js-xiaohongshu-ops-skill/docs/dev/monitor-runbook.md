# Monitor Runbook（小红书）

> 最后更新：2026-05-05  
> 目标：把 monitor daemon 从「代码 ready」推进到「实战 ready」，沉淀真实长跑数据。

## 0. 前置条件

- js-eyes 浏览器扩展已安装、ws server (`ws://localhost:18080`) 已起。
- 浏览器内已登录小红书（`web_session` cookie 存在）。可先跑：
  ```bash
  node skills/js-xiaohongshu-ops-skill/index.js login --pretty
  # 或：node skills/js-xiaohongshu-ops-skill/index.js session-state --pretty
  ```
- skill 已 `pnpm i` / 软连完成。

## 1. 一键启动（24-48h 长跑）

```bash
SKILL=skills/js-xiaohongshu-ops-skill

# 1) 初始化默认 config（已存在则跳过）
node $SKILL/index.js monitor init

# 2) 加目标
#    选 1 个稳定的"内容产出型"用户 + 1 个低噪关键词
node $SKILL/index.js monitor add user 5d40ee1900000000160347e8 --channels console
node $SKILL/index.js monitor add search "穿搭" --channel-type 图文 --limit 20

# 3) 同步跑一次确认通路
node $SKILL/index.js monitor check --once
node $SKILL/index.js monitor list

# 4) 启动循环 daemon（每小时一次，console 通知，避免 webhook 噪音）
node $SKILL/index.js monitor daemon --interval 3600 &
node $SKILL/index.js monitor status
```

关键参数：

- `--interval 3600`：每小时跑一次完整 check；保守起见首轮长跑不要更密。
- `--channels console`：仅 console 通知，长跑期间不打扰外部 IM。
- 监控目标尽量选 1 user + 1 search，控制变量。

## 2. 观察清单（每 6-12h 看一次）

文件位置（macOS / Linux）：

- 配置：`~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/config.json`
- 状态：`~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/state/<target>.json`
- 日志：`~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/logs/check-YYYYMMDD.log`
- pid：`~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/daemon.pid`

每次观察至少看：

| 指标 | 怎么看 | 健康参考 |
| --- | --- | --- |
| 心跳频率 | `grep daemon_tick logs/check-*.log \| wc -l` | ≈ `interval` 一致 |
| 每轮 OK 行数 | `grep '"ok":true' logs/check-*.log \| wc -l` | 接近 tick 数 × target 数 |
| risk hit 频率 | `grep risk_hit logs/check-*.log \| wc -l` | < 5% tick 数；持续上升要警觉 |
| dedup 命中 | `grep dedup logs/check-*.log` | 同一笔记不应被反复通知 |
| state 文件大小 | `du -h state/*.json` | 单文件 < 1MB；持续暴涨说明长尾未截断 |
| daemon 进程内存 | `ps -o rss= -p $(cat daemon.pid)` | 200MB 内稳定，不应单调上升 |
| antiCrawlState | history JSONL 里 `antiCrawlState.paused` | 不应一直 paused |

也可以用 skill 的 records 命令快速看上游数据：

```bash
node $SKILL/index.js records --tool xhs_get_user_notes --last 5 --pretty
node $SKILL/index.js records --tool xhs_search_notes --last 5 --pretty
```

## 3. 异常处置

- **daemon 卡住 / 不再产生新日志**：
  ```bash
  node $SKILL/index.js monitor stop
  # 等 5 秒
  node $SKILL/index.js monitor status   # 确认 running:false
  node $SKILL/index.js monitor daemon --interval 3600 &
  ```
- **risk_hit 飙升 / antiCrawlState.paused 持续 true**：先停 daemon，去浏览器手动确认页面是否被 WAF 拦（验证码 / 登录页）。手动恢复后再起。
- **state 文件 > 5MB**：v1 schema 不做长尾截断，可手动备份 + 清空，下一轮重建。这是 PR-C3 的输入信号。
- **登录态丢失**（`login_required` 出现）：
  ```bash
  node $SKILL/index.js login --timeout-ms 600000 --pretty
  # 登录成功后 daemon 不需要重启，下一轮 tick 自动恢复
  ```

## 4. 一键停止 + 数据归档

```bash
node $SKILL/index.js monitor stop
node $SKILL/index.js monitor status   # running:false 确认

# 归档当前长跑数据到 journal 同级目录，便于 PR-B1 写报告
ARCHIVE=~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor-archive/$(date +%Y%m%d-%H%M)
mkdir -p "$ARCHIVE"
cp -r ~/.js-eyes/skill-data/js-xiaohongshu-ops-skill/monitor/{config.json,state,logs} "$ARCHIVE"/
echo "$ARCHIVE"
```

## 5. 长跑产出（PR-B1 输入）

跑完 24-48h 后产出"长跑数据快照"，至少回答：

1. daemon 内存 / CPU 是否稳定？
2. 反爬触发是否过敏感？误报率怎样？
3. dedup 是否正确去重？同一笔记是否被多次通知？
4. state 文件长尾增长趋势？
5. selector 是否漂移？（对比 v3.0 实战记录里的命中率）
6. 是否暴露新的 bug（如 SPA fallback 失效、cookie 失效未感知等）？

把回答写入 [`journal/<YYYY-MM-DD>/xhs-monitor-longrun-report.md`](../../../../journal/)，作为 Phase B（B1 → B2）的决策输入。

## 6. 每周 probe 快照（PR-C1）

每周手动跑一次 probe 快照，监测 selector / 字段是否漂移：

```bash
# 1) 浏览器内手动停在以下页面（按需）：
#    - 任意笔记详情页 /explore/<id>?xsec_token=...
#    - 用户主页 /user/profile/<id>
#    - 搜索结果页 /search_result?keyword=...
# 2) 一键跑全部 probe：
node $SKILL/scripts/_dev/probe-snapshot.js --pretty
#    输出：tests/__snapshots__/dom/<YYYY-MM-DD>.json

# 3) 与上周快照对比：
node $SKILL/scripts/_dev/diff-snapshot.js \
  $SKILL/tests/__snapshots__/dom/2026-04-28.json \
  $SKILL/tests/__snapshots__/dom/2026-05-05.json
```

diff 的 `okCountDelta < 0` 或 `changedProbes > 0` 都是漂移信号；逐 probe 看 `dataKeys.removed` 与 `numericChanges`，确认是 XHS 真改 DOM 还是采样问题。每周快照不上 CI（依赖浏览器登录态），等稳定后再考虑。

## 7. 不做（明确）

- 长跑期间不要切换 `--interval`，避免数据噪音。
- 长跑期间不要新增/删除 target，等下一轮长跑前调整 config。
- 长跑期间不要并行跑 `xhs note` / `xhs comments` 之类的人工抓取，避免与 daemon 互相影响 rate limiter 和反爬画像。
