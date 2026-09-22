# 开发说明

## 环境与配置

使用 Node.js 18 或更高版本。执行 `npm install` 安装开发依赖，复制 `.env.example` 到 `.env` 配置本地端口、SQLite 路径和首次管理员。不要把 `.env`、数据库、图片或启动日志加入提交。

运行时配置由 `scripts/runtime-config.cjs` 加载，系统环境变量优先于 `.env`。`HOST` 仅支持本机地址，SQLite 可通过 `SQLITE_PATH` 指向可执行文件，或放在 `tools/sqlite3.exe`、系统 `PATH` 中。

## 代码边界

- `serve.js`：HTTP 服务、SQLite 读写、上传、登录、授权和静态资源服务。
- `assets/`：页面脚本、样式、国际化、共享 API 和滤镜资源。
- `assets/color-grade/workbench/`：调色工作台按目录、状态、预览、滤镜库及交互导出拆分的经典脚本；`color-grade.html` 的加载顺序是运行时契约。
- `src/templates/color-grade/`：调色页面的构建期模板。`head.html`、页面区域、弹窗和脚本顺序在此维护；`grade-tone.html` 由构建配置渲染阴影、中间调和高光控件。
- `color-grade.html`：由 `npm run build:html` 生成的完整入口页面，供 `serve.js` 和独立版构建直接使用。
- `src/core/`：色彩处理、LUT 和转换核心，不直接依赖页面 DOM。
- `scripts/`：启动、语法检查、项目检查、独立版构建和发布校验。
- `tests/fixtures/`：需要随源码提交的测试样本；`tests/artifacts/` 为本地测试输出。

调色工作台固定文案维护在 `assets/locales/color-grade-en-US.js`，由 `assets/color-grade/color-grade-i18n.js` 处理。用户输入、用户名和文件名应保持 `translate="no"`，日期使用 `data-i18n-date` 保存原始 ISO 值，下拉框必须保持稳定的 `value`。

## 验证

```powershell
npm test
npm run build:html
npm run check:html
npm run check
npm run format:check
npm run check:project
npm run build:standalone
npm run check:standalone
```

`npm run build:html` 将模板拼接为完整页面。`npm run check:html` 验证生成页未过期、150 个受控 ID 不重复且未缺失、样式和脚本路径存在、脚本顺序不变，并确认完整版保留登录入口。`npm test` 以 Node 测试运行器执行单元和浏览器测试。`npm run check` 会先运行 HTML 契约检查，再进行 JavaScript 语法检查。`npm run check:project` 检查资源引用、重复 ID、数据库完整性和服务可访问性，运行前须启动服务；它只读检查数据库，不会导入目录图片。

Prettier 使用 2 空格缩进、100 字符行宽、单引号和 ES5 尾逗号。修改前端或脚本后先运行 `npm run format:check`，需要修正格式时运行 `npm run format` 后复查。

## 独立版

独立版构建由 Vite 配置和 `scripts/` 中的发布校验脚本完成。常用入口为 `npm run build:standalone`、`npm run check:standalone` 和 `npm run package:standalone`。发布校验会依赖既有支持、隐私和启动说明，移动这些文档时必须同步更新 `scripts/standalone-runtime-manifest.cjs` 与打包脚本。

`dist/` 是生成目录，不应提交。独立版运行时仅监听本机回环地址；其详细边界见 [支持范围](support.md) 和 [本地数据说明](privacy.md)。
