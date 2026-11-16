# 主页维护

主页由 `README.md`、`assets/profile/` 中的原创 SVG 横幅，以及 `scripts/profile/` 中的项目配置与更新脚本组成。

## 修改内容与外观

- 个人简介、导航、技术栈徽章和页脚直接编辑 `README.md`。
- 徽章使用 Shields.io 的 `flat-square` 样式，左侧标签为深灰色，右侧展示彩色内容。不指定未经确认的语言版本。
- 深浅主题横幅分别为 `assets/profile/hero-dark.svg` 和 `assets/profile/hero-light.svg`，通过 `<picture>` 根据配色偏好切换。
- 项目顺序、说明和标签在 `scripts/profile/profile.config.json` 中维护。所有项目使用同等大小的展示单元；项目数为奇数时补充一个仓库导航入口。
- `README.md` 中 `PROJECTS:START` 与 `PROJECTS:END` 之间的内容由脚本生成。修改该区块中的介绍和标签，应修改配置文件，否则下次更新会覆盖手工改动。

## 自动更新

`.github/workflows/profile.yml` 会在以下时机运行：

- 每天 UTC 01:23 和 13:23；GitHub 可能延迟执行定时任务。
- `main` 分支中的 README、项目更新脚本或工作流发生变更。
- 在 Actions 页面手动执行 `Update profile`。

脚本读取配置中公开仓库的 Star、Fork 数量和最后推送日期，刷新 README 的项目区块。项目链接、介绍、标签与顺序来自配置；更新时间统一使用 UTC 日期。它不会拉取个人动态或生成贡献统计。

工作流复用固定版本的 `actions/checkout`、`actions/setup-node` 与 `stefanzweifel/git-auto-commit-action`。自动提交只包含 `README.md`，提交标题沿用仓库历史中的 `UpData`。项目数据未变化时不产生提交。

脚本使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需额外配置个人访问令牌。写权限仅授予更新 job。自动更新仅在原仓库的默认分支执行；工作流进入 `main` 后，定时和手动入口才能生效。

GitHub API 请求失败、项目数据无效或区块标记缺失时，脚本会报错并保留原 README；获取数据期间发生的手工修改也会被保留。定时任务在公开仓库长时间无活动时可能被 GitHub 停用，可在 Actions 页面重新启用。如果分支保护禁止机器人直接提交，工作流会失败，需要按仓库现有策略处理提交权限。

## 本地更新

需要 Node.js 22，无需安装 npm 依赖。在仓库根目录执行：

```powershell
node scripts/profile/update-profile.mjs
```

公开仓库支持匿名读取；遇到 API 限流时，可以使用当前会话中已有的 `GH_TOKEN` 或 `GITHUB_TOKEN` 环境变量。令牌不应写入脚本、配置或 Git。

脚本以 UTF-8 无 BOM 写入。其他文件也应保持 UTF-8 无 BOM 与 LF 换行。横幅不依赖外部图片服务；技术栈及项目数据徽章由 Shields.io 提供。
