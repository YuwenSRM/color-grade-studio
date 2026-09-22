# Real Landscape

本地运行的图片图库、审核后台和调色工作台。Node.js 服务提供页面、账户、SQLite 数据和图片上传；调色台也可构建为仅本机访问的独立版本。

## 快速开始

需要 Node.js 18 或更高版本，以及可用的 SQLite 命令行程序。

```powershell
npm install
Copy-Item .env.example .env
.\start-server.bat
```

服务默认打开 `http://127.0.0.1:4173/login.html`。也可执行 `node serve.js` 手动启动。`start-server.bat --no-open` 会启动并验证服务，但不打开浏览器。

`.env` 中可设置端口、SQLite 路径和首次管理员账户。不要提交该文件或其中的任何凭据。

## 功能

- 图片库浏览、上传、标题与说明。
- 角色登录、图片审核、质量评分、统计和账号管理。
- 本地图片调色、裁切、LUT 滤镜、导出和浏览器本地滤镜备份。
- 中文/英文和明暗主题。

## 常用命令

```powershell
npm test
npm run check
npm run format:check
npm run check:project
npm run build:standalone
```

`check:project` 需要先启动本地服务。测试使用隔离环境或模拟接口，不应修改现有图库记录；浏览器验收和独立版打包会生成本地输出，已由 Git 忽略。

GitHub Actions 在 Node.js 20 环境执行 `npm ci`、`npm run check`、`npm run format:check` 和 `npm test`。该工作流只做源码质量检查，不启动主服务，也不读取或写入本地运行数据。

## 项目结构

```text
assets/       Browser scripts, styles, locales, and filters
src/core/     Color processing and LUT conversion core
scripts/      Development, validation, build, and launcher helpers
tests/        Automated tests and committed fixtures
docs/         Usage, development, support, and historical references
launcher/     Standalone Windows launcher assets
```

`assets/color-grade/workbench/` contains the ordered color-grading workbench
resources. `catalog.js`, `state.js`, `preview-renderer.js`, `filter-library.js`,
and `interactions-crop-export.js` remain classic scripts and are loaded in that
order by `color-grade.html`; the four `styles/` files are loaded in the same
order as the original cascade. `assets/pages/color-grade.js` and
`assets/pages/color-grade.css` are compatibility entry points only.

运行时数据位于 `data/`、`image-library/` 和 `uploads/`，均不会提交到 Git。完整说明见：

- [使用说明](docs/usage.md)
- [开发说明](docs/development.md)
- [已知问题](docs/known-issues.md)
- [独立版启动说明](docs/standalone.md)
- [独立版支持范围](docs/support.md)
- [独立版本地数据与备份](docs/privacy.md)

## 许可与发布

内置 LUT、测试样本和第三方内容须按各自附带的许可使用。发布到公开仓库前，请补充项目许可证，并确认不包含数据库、上传图片、访问密钥或其他本地数据。
