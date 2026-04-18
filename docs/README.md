# docs/ 目录说明

本目录是 **GitHub Pages 站点根**（CNAME → [js-eyes.com](https://js-eyes.com)），混合承载四类内容：

| 类别 | 代表文件 | 说明 |
|------|---------|------|
| 营销落地页 | `index.html`、`i18n/locales/*.js` | 站点主页（Tailwind + three.js） |
| 发布 artifact | `install.sh`、`install.ps1`、`js-eyes-skill.zip(.sha256)`、`skills/<id>/<id>-skill.zip(.sha256)` | 被 `curl \| bash`、`js-eyes skills install`、`fetchSkillsRegistry` 直接引用，**文件名 / URL path 不可改** |
| 注册表 | `skills.json` | 扩展技能注册表，主插件通过 `SKILLS_REGISTRY_URL` 拉取 |
| 用户文档 | `README_CN.md`、`native-messaging.md` | 面向使用者的说明 |
| 开发者文档 | `dev/**/*.md` | 面向开发者的契约、指南、Roadmap |

## 变更约束

1. **artifact URL 锁死**：`install.{sh,ps1}`、`*.zip(.sha256)`、`skills.json`、`skills/<id>/…` 的相对路径不可改，否则 `install` 脚本、`skills.json` 的 `downloadUrl`、`SKILLS_REGISTRY_URL` 全部失效。
2. **新增发布产物**时请同步更新 `skills.json`，并保证 `sha256` 与 `size` 与 zip 一致。
3. **开发者向 markdown** 请放到 [dev/](dev/)，不要与 artifact 平铺。
4. **可运行的 skill 样例代码**不要放这里，放仓库根 [/examples/js-eyes-skills/](../examples/js-eyes-skills/)。
5. `dev/js-eyes-skills/` = 本仓库 `skill.contract.js` 契约下的扩展技能体系；`dev/skills/` = 未来对外部通用 Skills（Anthropic / Cursor 等）兼容层的 Roadmap 占位。

## 约定的命名空间

- **JS Eyes Skills**（专有名词）：本仓库定义的、遵循 `skill.contract.js` 契约的扩展技能。目录 / 路径前缀统一用 `js-eyes-skills/`。
- **Skills**（通用，未来）：泛指 Anthropic Agent Skills / Cursor Skills / Claude Code Skills 等业界"skill"概念。预留 `skills/` 命名空间给未来的兼容层。

> 现有代码层的 `skills/`、`skillsDir`、`js-eyes skills <cmd>` CLI、`@js-eyes/skill-recording` 等标识符**暂不改名**，通过开发者文档里的"命名澄清"表消歧义。详见 [dev/js-eyes-skills/README.md](dev/js-eyes-skills/README.md)。
