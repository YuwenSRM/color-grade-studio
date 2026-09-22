# Color Grade Studio

本地运行的图片图库、审核后台和调色工作台。完整版本提供账户、SQLite 数据、图片上传和管理页面；调色工作台也可构建为不依赖 Node.js 的本机独立版。

## 选择使用方式

| 使用者           | 选择                                                                  | 包含内容                                                    |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| 普通使用者       | [独立版发布](https://github.com/YuwenSRM/color-grade-studio/releases) | 本地导入图片、调色、裁切、LUT、导出，不含登录、图库和上传。 |
| 开发者或自托管者 | 源码完整版本                                                          | 登录、图片库、上传、审核、账号管理和调色工作台。            |

### 使用独立版

从 [Releases](https://github.com/YuwenSRM/color-grade-studio/releases) 下载独立版压缩包，完整解压后双击 `ColorGradeStudio.vbs`。不需要安装 Node.js，也不需要联网。

`ColorGradeStudio.cmd` 会显示启动诊断；需要停止本地服务时，在包目录运行：

```bat
ColorGradeStudio.cmd --stop
```

独立版仅在 `127.0.0.1` 提供本机页面。图片仅保留在当前浏览器会话，滤镜、收藏、主题和语言保存于浏览器本地数据。清除浏览器站点数据前，请在调色台中备份滤镜。完整限制见[独立版支持范围](docs/support.md)。

### 从源码启动完整版本

需要 Node.js 18 或更高版本，以及可用的 SQLite 命令行程序。

```powershell
git clone https://github.com/YuwenSRM/color-grade-studio.git
Set-Location color-grade-studio
npm install
Copy-Item .env.example .env
.\start-server.bat
```

服务默认打开 `http://127.0.0.1:4173/login.html`。也可执行 `node serve.js` 手动启动。`start-server.bat --no-open` 会启动并验证服务，但不打开浏览器。

在首次启动前，请在 `.env` 中替换 `ADMIN_PASSWORD=replace-with-a-strong-unique-password`。`.env` 可设置端口、SQLite 路径和首次管理员账户；不要提交该文件或其中的任何凭据。

如果系统找不到 SQLite，请将 `sqlite3` 加入系统 `PATH`，或在 `.env` 的 `SQLITE_PATH` 中填写其可执行文件路径。

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
npm run package:standalone
```

`check:project` 需要先启动本地服务。测试使用隔离环境或模拟接口，不应修改现有图库记录；浏览器验收和独立版打包会生成本地输出，已由 Git 忽略。

GitHub Actions 在 Node.js 20 环境执行 `npm ci`、`npm run check`、`npm run format:check` 和 `npm test`。该工作流只做源码质量检查，不启动主服务，也不读取或写入本地运行数据。

## 构建与分享独立版

发布独立调色工具前执行：

```powershell
npm run package:standalone
```

该命令会重新构建并验证独立版，输出完整可分发目录：

```text
dist/standalone-candidate/
```

将该目录整体压缩后上传到 GitHub Release。不要只分享其中的 `app/`、启动器或某一个 HTML 文件。此目录中的 PowerShell 启动器仍是候选实现，不是经过签名的安装程序；发布前请阅读[发行说明](docs/release-notes.md)。

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

## 数据与隐私

运行时数据位于 `data/`、`image-library/` 和 `uploads/`，均不会提交到 Git。克隆仓库不会获得既有账号、数据库、图片库或上传图片；迁移完整版本前应安全备份这些目录。完整说明见：

- [使用说明](docs/usage.md)
- [开发说明](docs/development.md)
- [已知问题](docs/known-issues.md)
- [独立版启动说明](docs/standalone.md)
- [独立版支持范围](docs/support.md)
- [独立版本地数据与备份](docs/privacy.md)

## 许可与发布

内置 LUT、测试样本和第三方内容须按各自附带的许可使用。当前仓库尚未声明项目级许可证；复用或再分发前请先确认许可范围，并确保不包含数据库、上传图片、访问密钥或其他本地数据。
