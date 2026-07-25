# examples/js-eyes-skills/

可运行的 **Skill Runtime V2** 样例（`skill.manifest.json` + `skill.entry.js` +
`skill.definition.js`）。发现阶段只读静态 manifest，不会执行 entry。

## 样例索引

| 样例 | 难度 | 覆盖特性 |
|------|------|---------|
| [`js-hello-ops-skill/`](js-hello-ops-skill/) | 入门 | 单工具、V2 manifest/entry、本地 CLI |

V1 `skill.contract.js` 样例已移除；迁移说明见 [`examples/legacy/`](../legacy/)。

## 运行步骤

```bash
cp -R examples/js-eyes-skills/js-hello-ops-skill ~/my-skills/
cd ~/my-skills/js-hello-ops-skill
npm install

# 接到当前主机（extra 模式）
js-eyes skills link ~/my-skills/js-hello-ops-skill

# 或直接 CLI
node ~/my-skills/js-hello-ops-skill/index.js title 123
```

## 新建 Skill 最小文件

1. `package.json` — `name` 即 skill id  
2. `skill.definition.js` — `TOOL_DEFINITIONS`（含 `risk` / `capabilities`）+ skill 级 `capabilities` / `requirements`  
3. `skill.entry.js` — `handlers`（官方技能优先用 `@js-eyes/skill-scaffold` 的 `createSkillEntry`；也可手写或用 `@js-eyes/skill-runtime` 的 `createNativeHandlers`）  
4. `skill.manifest.json` — 可用 `@js-eyes/skill-scaffold` 的 `buildSkillManifest` 从 definition 生成，须与 tools 一致  
5. `SKILL.md` — 面向使用者的说明  

工具表以 `TOOL_DEFINITIONS` 为唯一源；不要再导出 `createOpenClawAdapter`。
