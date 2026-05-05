# xhs monitor 24-48h 长跑报告（模板占位）

> 创建：2026-05-05  
> 状态：**模板占位（TBD）** — 待 PR-A3 runbook 启动并跑满 24-48h 后回填。  
> 关联：[docs/dev/monitor-runbook.md](../../skills/js-xiaohongshu-ops-skill/docs/dev/monitor-runbook.md) · [xhs-ops-skill-v3-upgrade.md](./xhs-ops-skill-v3-upgrade.md) · 计划 [xhs_skill_v3.1_实战化_42818c34.plan.md]

## 0. 元数据（实际开跑后回填）

| 项 | 值 |
| --- | --- |
| 启动时间 | TBD |
| 停止时间 | TBD |
| 总时长 | TBD |
| target 数 | 1 user + 1 search |
| interval | 3600s |
| 通知通道 | console |
| skill 版本 | 3.0.x（含 PR-A1/A2 改动） |
| 浏览器登录态 | TBD（关注是否中途失效） |

## 1. 总体指标

| 指标 | 期望 | 实际 | 备注 |
| --- | --- | --- | --- |
| daemon tick 次数 | ≈ 24 / 48 | TBD | |
| 每轮 ok 比例 | > 95% | TBD | |
| risk_hit 频率 | < 5% | TBD | |
| dedup 命中（同笔记重复通知） | 0 | TBD | |
| daemon 内存波动 | 不单调上升 | TBD | RSS 曲线 |
| state 文件大小 | < 1MB | TBD | |
| login_required 出现次数 | 0 | TBD | |
| antiCrawlState.paused 累计 | 0 | TBD | |

## 2. 关键问题回答（B1 必答）

> 这些回答直接决定 B2/C3 是否做。

1. **daemon 内存 / CPU 稳定吗？**  
   TBD（结论：稳定 / 漏 / 抖）。

2. **反爬触发是否过敏感？误报率多少？**  
   TBD。如果 risk_hit 高且大多数是 false positive → **B2 优先级抬高**，必须做四档分类。

3. **dedup 正确吗？**  
   TBD。如果同一笔记被多次通知 → 可能要在 B2 里附带 dedup 修复。

4. **state 文件长尾增长趋势？**  
   TBD（线性 / 上凸 / 平稳）。如果 48h 已 > 5MB → **C3 必须做**（schema v2 + 长尾截断）。

5. **selector 漂移了吗？**  
   TBD。对比 v3.0 实战记录里的命中率；如果出现新的 0 命中 → **C1 优先级抬高**（probe 快照）。

6. **暴露了哪些新 bug？**  
   - TBD
   - TBD

## 3. 数据样本（采样）

```text
TBD：贴 5-10 行 logs/check-YYYYMMDD.log 摘要
TBD：贴 1 个 state/<target>.json 的关键字段
TBD：贴 1 次 risk_hit 完整上下文
```

## 4. 决策

> **PR-B2 是否立即开工？**

- [ ] 立即开工 PR-B2（WAF 四档分类）
- [ ] 优先修长跑暴露的更高优先 bug：______（描述）
- [ ] 长跑数据健康，B2 可延后到本月底

> **PR-C3 是否进入本月底必做？**

- [ ] 必做（state 长尾已暴露问题）
- [ ] 不做（v1 schema 还能扛）

## 5. 行动项

- [ ] TBD

---

**回填指引**：长跑结束后，按 [monitor-runbook.md §4](../../skills/js-xiaohongshu-ops-skill/docs/dev/monitor-runbook.md) 归档数据，然后把上面所有 TBD 替换为真实值，最后勾选 §4 决策项并提交。
