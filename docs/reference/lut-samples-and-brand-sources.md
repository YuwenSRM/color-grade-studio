# P0-1 LUT 样本与品牌来源报告

版本：v1.0  
完成日期：2026-09-11  
适用项目：`D:\ChatG\Coloer\_AI`  
阶段状态：**已完成，可以进入 P0-2 `.cube` 解析验证器开发。**

## 1. 本阶段交付结论

P0-1 已建立一套可重复生成、可校验的 CUBE 测试样本，并完成哈苏、尼康、徕卡三组品牌来源的技术分类。

根据项目方确认，本项目当前仅用于个人学习与本地研究，因此**品牌和作者授权审批不作为 P0 阻塞项**。本阶段仍保留品牌、作者、来源 URL 和文件取得方式，用于技术追踪、效果命名和以后范围变化时复核；不在 P0 做法务审批。

本阶段没有修改调色台页面、滤镜数据、渲染器或后端。生成的 LUT 只位于测试夹具目录，不会出现在滤镜库中。

## 2. 已交付内容

| 交付物         | 路径                                              | 用途                                                 |
| -------------- | ------------------------------------------------- | ---------------------------------------------------- |
| LUT 样本集     | `tests/fixtures/luts/`                            | 提供有效、边界、故障和真实方言输入                   |
| 样本清单       | `tests/fixtures/luts/manifest.json`               | 记录预期分类、网格、色彩假设、字节数、行数和 SHA-256 |
| 样本生成器     | `scripts/generate-p0-lut-samples.cjs`             | 重新生成项目自有样本与清单，保证结果可复现           |
| 完整性测试     | `tests/lut-fixtures.test.cjs`                     | 校验样本数量、分类、字节数和哈希                     |
| 品牌结构化清单 | `docs/reference/lut-brand-source-catalog.json`    | 供后续开发或数据迁移读取的品牌、作者、格式和来源记录 |
| 本报告         | `docs/reference/lut-samples-and-brand-sources.md` | P0-1 决策、范围与 P0-2 输入说明                      |

## 3. LUT 样本清单

当前 `manifest.json` 共登记 **19 个可执行测试文件**：

| 分类                 | 数量 | 文件或用途                                                  | P0-2 预期                                         |
| -------------------- | ---: | ----------------------------------------------------------- | ------------------------------------------------- |
| 恒等 3D CUBE         |    3 | `identity-17.cube`、`identity-33.cube`、`identity-65.cube`  | 接受；后续应用时应在既定误差内保持颜色            |
| 合成创意 3D CUBE     |    3 | 暖调人像、冷调风景、干净对比                                | 接受；用于解析、预览和基准输出                    |
| 正常自定义 DOMAIN    |    1 | 0.25–0.75 的 4 点 LUT                                       | 接受并保留域信息                                  |
| SDR 策略边界         |    2 | 负值 DOMAIN；OpenColorIO IRIDAS 非默认域/超范围输出         | 能识别语法，但首期 SDR 策略明确拒绝，不能静默截断 |
| 合成故障/不支持文件  |    8 | 缺行、多行、NaN、1D、1D+3D、未知指令、反向 DOMAIN、列数错误 | 拒绝并返回稳定的错误代码                          |
| OpenColorIO 真实方言 |    2 | IRIDAS 1D、Resolve 1D+3D                                    | 识别为有效方言，但因超出首期 3D 子集而拒绝        |

其中 **7 个应接受、2 个应识别后按 SDR 策略拒绝、10 个应因损坏或类型不支持而拒绝**。

项目自有样本固定采用红通道最快、绿通道其次、蓝通道最慢的数据顺序。P0-2 仍必须通过恒等 LUT 和通道测试验证解析轴序，不能只相信注释。

单个文件超过拟定 20 MiB 的测试不作为常驻夹具保存，以免无意义扩大项目体积。P0-2 使用相同头部加注释填充或内存 `File/Blob` 按需生成 20 MiB + 1 字节输入，验证在完整解析前按大小拒绝。

## 4. 品牌与格式核实结果

| 品牌内容                                  | 作者/提供方              | 实际交付形态                                      | 是否已取得可执行文件 | P1 直接按 3D CUBE 导入                   |
| ----------------------------------------- | ------------------------ | ------------------------------------------------- | -------------------- | ---------------------------------------- |
| Hasselblad HNCS                           | Hasselblad               | 相机与 Phocus 色彩处理体系                        | 否                   | 否                                       |
| Hasselblad HNCS HDR                       | Hasselblad               | HDR 相机/显示工作流                               | 否                   | 否，且超出首期 SDR 范围                  |
| Nikon Imaging Recipes / 云创              | Nikon 或页面标注的创作者 | Nikon Imaging Cloud 下发的 Custom Picture Control | 否                   | 否                                       |
| Nikon Flexible Color / Rich Tone Portrait | Nikon                    | NX Studio 与兼容相机 Picture Control              | 否                   | 否                                       |
| Nikon RWG/Log3G10 技术 LUT                | Nikon                    | 下载包中的 33/65 点 `.cube`                       | 本阶段未纳入样本集   | 语法可研究；色彩空间不适合普通 sRGB 照片 |
| Leica Essential/Core Looks                | Leica Camera AG          | FOTOS、兼容相机或 App 内处理                      | 否                   | 否                                       |
| Leica Artist Look WLM                     | Greg Williams 与 Leica   | Leica 生态内的 Artist Look                        | 否                   | 否                                       |

哈苏另有可追溯的官方 JPEG/RAW 对照样片。P0-1 选定 `B0000994.jpg` + `B0000994.3FR` 作为后续参考对：X1D-50C + XCD 4/21，摄影师 Haitong Yu。两份文件约 41.7 MB 和 110.4 MB，因此本阶段只记录官方 URL、大小和作者，不把约 145 MiB 素材常驻项目。

结论不是“这些品牌无法做”，而是它们需要分成两条实施路线：

1. P1 的通用 LUT 路线：为普通 SDR sRGB 照片提供项目自有的 `.cube` 创意滤镜；品牌资料只作为观感研究与来源说明。
2. 后续原生格式路线：针对 Nikon `.NCP/.NP2/.NP3` 等真实文件另做解析和引擎匹配，不能把扩展名改成 `.cube`。

Nikon 官方视频 CUBE 可以验证网格大小和解析性能，但它的输入是指定 Log/广色域工作流。把它直接应用到普通 JPEG/WebP 会产生错误观感，因此不进入首批照片创意滤镜名单。

## 5. 首批品牌学习方向

以下只是 P1 视觉原型候选，不表示已取得厂商算法文件：

| 品牌 | 第一轮候选                                                       | 建议作者字段                                            | 技术目标                                           |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 哈苏 | 自然肤色、产品颜色、柔和高光                                     | `Real Landscape`；参考来源写 Hasselblad HNCS            | SDR sRGB 创意 LUT，优先控制肤色与高光渐变          |
| 尼康 | Rich Tone Portrait、云创人像/风景方向、创意 Picture Control 方向 | 自研时为 `Real Landscape`；真实配方保留页面作者         | SDR sRGB 自研 LUT；原生 NP3 不在 P1 冒充兼容       |
| 徕卡 | Classic、Chrome、Contemporary；随后 Teal、Brass、WLM 黑白方向    | 自研时为 `Real Landscape`；WLM 参考作者为 Greg Williams | 根据官方观感描述制作独立 LUT，并用自有测试照片评审 |

Nikon Cloud 官方新闻接口已核验的近期作者批次包括：2026-06 的 Amy Shore、MASAYA；2026-02 的 Nagisa Ichikawa、jyota tomonori、HYEYA、Kyungjun Lee；2025-12 的 Nikon | RED、Ludwig Favre、Siinapse、Instant Film Studio。作者名单证明来源可追溯，但配方仍通过 Cloud/兼容相机使用，不因此变成 `.cube` 文件。

Leica 当前官方页还列出 Silver、Bleach、Sepia、Blue、Selenium、Eternal，以及 Standard、Natural、Vivid、Monochrom Natural、Monochrom High Contrast 等 Core Looks。结构化清单已保留这些名称，P1 不需要一次全部实现。

## 6. P0-2 的冻结输入

P0-2 可以直接按以下规则开发：

- 首期只接受明确的 3D `.cube` 子集。
- 支持注释、`TITLE`、`LUT_3D_SIZE`、`DOMAIN_MIN`、`DOMAIN_MAX` 和三列浮点数据。
- 重点支持 17、33、65 点，同时允许 2–65 的合法整数网格。
- 1D 和 1D+3D 组合 LUT 必须明确拒绝，不忽略未知指令。
- 首期输出链路为 SDR sRGB；超出 0–1 可表达范围的值先拒绝，不静默裁剪。
- 建议单文件上限 20 MiB；在读取全部文本前先检查大小。
- 数据行数必须精确等于 `N³`，数值必须有限，DOMAIN 每通道必须满足 `MIN < MAX`。
- 解析结果保留源标题、网格、DOMAIN、原始数值和内容哈希。

## 7. 验证记录

已执行：

```powershell
node scripts/generate-p0-lut-samples.cjs
node --test tests/lut-fixtures.test.cjs
```

生成结果：19 个 LUT 测试文件；7 个接受样本、2 个策略边界样本、10 个拒绝样本。完整性测试 2/2 通过。

## 8. 来源

- [Hasselblad Phocus / HNCS](https://www.hasselblad.com/phocus/phocus-for-pc-mac/)
- [Hasselblad X2D II / HNCS HDR](https://www.hasselblad.com/x-system/x2d-ii-100c/)
- [Hasselblad X System 官方样片索引](https://www.hasselblad.com/learn/sample-images/x-system/)
- [Nikon Imaging Cloud：Imaging Recipes 介绍](https://imagingcloud.nikon.com/recipe/introduction)
- [Nikon Imaging Cloud：色彩方案作者新闻接口](https://api.user.cwp.imagingcloud.nikon.com/news?lang_code=zhCn&category_code=1)
- [Nikon 官方发布：Imaging Recipes、Flexible Color 与 Rich Tone Portrait](https://www.nikon.com/company/news/2024/0617_imaging_01/)
- [NX Studio：NCP、NP2、NP3 导入导出](https://nikonimglib.com/nxstdo/onlinehelp/en/copy_custom_picture_controls_50.html)
- [NX Studio：Flexible Color](https://nikonimglib.com/nxstdo/onlinehelp/en/the_picture_controls_flexible_color_23.html)
- [Nikon RWG/Log3G10 技术 LUT](https://downloadcenter.nikonimglib.com/en/download/sw/274.html)
- [Leica Looks](https://leica-camera.com/en-int/photography/leica-looks)
- [Leica FOTOS](https://leica-camera.com/en-int/photography/leica-apps/leica-fotos)
- [OpenColorIO 测试文件](https://github.com/AcademySoftwareFoundation/OpenColorIO/tree/main/tests/data/files)

来源核对日期为 2026-09-10 至 2026-09-11。品牌页面内容可能更新，结构化清单保留了本次核对时使用的 URL。
