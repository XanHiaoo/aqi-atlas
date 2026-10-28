# AQI Atlas · 城市 AQI 年度概览

[![Tests](https://github.com/XanHiaoo/aqi-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/XanHiaoo/aqi-atlas/actions/workflows/ci.yml)
[![Pages](https://github.com/XanHiaoo/aqi-atlas/actions/workflows/pages.yml/badge.svg)](https://github.com/XanHiaoo/aqi-atlas/actions/workflows/pages.yml)

[在线查看](https://xanhiaoo.github.io/aqi-atlas/) · [GitHub Actions](https://github.com/XanHiaoo/aqi-atlas/actions)

基于 AQI.in 美标日值的本地空气质量网站。支持城市与地区搜索、实时 AQI、过去一年的日历热力图，以及两城共同日期的差异对比。

Python 3.10+，运行时仅使用标准库。页面资源随程序提供，无需前端构建。

微信原生版在独立分支 `feat/wechat-miniprogram` 开发，工程与测试说明见 [miniprogram/README.md](miniprogram/README.md)，当前验证边界见 [微信小程序验证记录](docs/wechat-miniprogram-verification.md)。

手机与电脑使用独立页面，首次访问按设备选择；页面底部可切换版本，浏览器会记住选择。两版共用历史数据、实时数据、城市选择和保存的排序。电脑版以手机改造前的 `6ad9214` 为基础，保留原有布局，增加拖动及键盘排序，并同步精简说明和重复链接。手机版包含底部五入口和紧凑全年日历。

## 启动

已有本地数据时，在项目根目录双击 **`update.cmd`**，或执行：

```powershell
.\run.ps1
```

浏览器打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。启动脚本依次寻找 `.venv`、`.runtime/python` 和系统 Python。保持服务运行即可使用实时数据、搜索和自动更新；关闭浏览器不会停止后台服务。

也可以直接运行：

```powershell
python -m aqirec --serve --open
```

直接打开 `output/index.html` 仅用于离线查看已生成的数据，无法使用实时 AQI、搜索和保存城市。

## 首次部署

Git 仓库只包含程序、页面和测试样本，不包含本机城市配置、采集缓存或发布页面。

1. 安装 Python 3.10+，在项目根目录准备虚拟环境：

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -e .
   ```

2. 在 AQI.in 官方城市页面保存包含公开客户端配置的 HTML 快照，放到 `data/aqiin/client.html`。也可使用 `--aqiin-page <文件路径>` 指定已保存的快照。程序读取页面公开配置，不读取浏览器账户或 Cookie。

3. 启动网站，在页面搜索并添加需要查看的城市：

   ```powershell
   python -m aqirec --serve --open
   ```

没有城市配置时显示空列表，不预设任何城市。添加城市时获取该城市的历史日值，保存结果在重启后继续生效。若公开配置失效，更新 `client.html` 后重新尝试获取。

## 功能

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 城市日历 | `/` | 实时 AQI、城市勾选、日历热力图、城市 × 月份热力图、日值累计分布和阈值占比 |
| 差异对比 | `/compare` | 两城共同日期的原值与差值、月均差距及累计分布 |

- **搜索与管理**：支持常见中文名和英文名；城市可加入日历，地区可展开平台匹配的下辖城市。比如“东京”“东京都”“Tokyo”会区分显示地区与城市。地区级结果本身不作为城市日值参与统计。
- **勾选与排序**：勾选决定展示和更新范围，选择会保存；城市右侧的 × 删除已保存的城市。取消勾选保留该城市配置。
- **累计分布**：城市日历按各城自己的有效日值计算天数和占比；滑块或 ≤50、≤100 快捷按钮可查看阈值读数。结果列表支持默认顺序、占比从高到低及从低到高排序，调整阈值后自动重排，并记住排序选择。
- **城市 × 月份**：按勾选顺序对比月度 AQI 中位数或良好日（AQI≤50）占比。默认仅使用所选城市共同有效的日期，也可切换为各城自身有效日期；每格显示使用日数与区间内日数。跨年月份分列，首尾月仅统计当前区间内日期，缺失不补零。
- **手机布局**：小屏使用底部导航和城市管理弹层，实时卡片可横向滑动。城市管理支持拖动手柄或按住卡片排序，勾选状态不变；手柄获得焦点后也可用方向键排序。完整城市顺序保存在浏览器，已选城市顺序同步到各图表及本地服务。城市标题、四项统计和全年迷你月历紧凑排列，一屏展示完整城市数据；点击日历色块，以浮层显示当日日期、AQI 和等级，全年总览保持不变。城市 × 月份热力图以月份为行，固定显示三列城市的宽度；不足三座时保留空位，更多城市可横向滑动，月份列保持固定，切换指标保留滚动位置。月份表没有额外浮层，手机端省去共同日期设置并保留原统计口径。分布高亮与排序、两城差异比较均保留。桌面继续使用原布局。
- **两城比较**：仅统计双方都有已发布日值、且非今日暂定的同一组日期。切换组合时使用共享色标。
- **实时数据**：后台约每 5 分钟尝试刷新，页面每 30 秒读取。失败时保留并标记可用的旧值，跨日旧值不冒充今日实时值。
- **每日更新**：北京时间 00:05 为已勾选城市尝试获取历史日值；平台未发布或请求失败时自动重试。服务恢复运行后会检查到期任务。

## 数据与统计口径

采用 AQI.in 官方日历接口的 `sensorname=aqi`，对应平台标注的 AQI (US)。日值和日期标签直接保留；平台日聚合时区与算法未独立核验。

默认区间为截至昨天的 365 个日期，随日期自动滚动。期间和月度均值按有效日等权计算；缺失不补零、不插值。AQI≤100 占比的分母为有效日数。跨年同名月份分别统计。实时 AQI 独立保存，不进入历史日值和均值。

原始响应、来源 URL、获取时间及 SHA-256 保存在本地快照中。页面目录中的 `source-policy.md` 和 `report.json` 提供当前覆盖范围与来源摘要。

来源：[AQI.in](https://www.aqi.in/cn/air-quality-map)。

## GitHub Pages 与 Actions

仓库：[`XanHiaoo/aqi-atlas`](https://github.com/XanHiaoo/aqi-atlas)。公开站点位于 <https://xanhiaoo.github.io/aqi-atlas/>。

GitHub Pages 发布可交互的数据快照：城市勾选、排序、两城对比、月份热力图和累计分布在浏览器中运行。搜索范围为已发布城市，勾选只保存在当前浏览器；新增城市、地区联网搜索和实时查询由本地 Python 服务提供。公开页面的 AQI 数值标为快照，并显示数据更新时间。

| Workflow | 触发方式 | 内容 |
| --- | --- | --- |
| `ci.yml` | 推送 main、Pull Request、手动 | Python 3.10/3.13 与 Windows 测试，验证静态构建 |
| `pages.yml` | 推送 main、手动、数据更新后 | 测试通过后构建并发布到 GitHub Pages |
| `refresh-data.yml` | 北京时间每日 00:17、06:17，或手动 | 获取并校验已发布城市的 AQI.in 数据，更新公共快照后重新发布 |

定时任务可能因 GitHub 排队而延迟。获取失败或新响应导致已有有效日值丢失时，流程会失败并保留上次快照与网站。

首次配置：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions** 添加 `AQIIN_CLIENT_TOKEN`，值为本地 `data/aqiin/client.html` 所含的官网公开客户端配置。它只通过 Actions Secret 使用，不写入公共快照。配置失效后更新这个 Secret。
3. 在 Actions 中运行 **Deploy GitHub Pages**；需要立即联网更新时运行 **Refresh published AQI data**。未配置 Secret 时，在线更新会跳过，现有快照仍可正常部署。

在本地添加城市或更新数据后，可主动更新公开版本：

```shell
python -m aqirec.pages export
git add site-data/snapshot.json
git commit -m "data: update published AQI snapshot"
git push
```

导出包含当前报告、默认勾选顺序与已获取的 AQI 快照。`site-data/snapshot.json` 会随仓库公开；原始缓存、`client.html`、更新日志与浏览器账户信息不进入发布目录。本地预览静态版本：

```shell
python -m aqirec.pages build
python -m http.server 8080 --directory dist
```

构建只读取公共快照，保留快照的历史日期范围，避免把旧数据标成新数据。部署流程采用 GitHub 官方 [Pages Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)，第三方步骤均固定到提交 SHA，由 Dependabot 检查更新。

## 命令行

```powershell
# 从本地快照重新生成页面，不发起历史数据请求
python -m aqirec

# 更新历史日值并启动网站
python -m aqirec --refresh --serve --open

# 生成指定范围；启动服务时保持该范围固定
python -m aqirec --start-date 2026-01-01 --end-date 2026-09-30 --serve

# 指定自然年度、发布目录或端口
python -m aqirec --year 2025 --output output-2025
python -m aqirec --serve --port 8766

# 查看全部参数
python -m aqirec --help
```

默认生成 `output/index.html`、`compare.html`、`report.json`、`daily.csv`、`summary.csv`、`monthly.csv` 和 `source-policy.md`。页面间共享同一份报告。

## 目录

```text
aqirec/
  aqiin_api.py          官方日历接口与快照校验
  cities.py             城市、地区搜索与城市配置
  data.py               城市模型、日期、AQI 分级与统计
  history.py            历史日值报告与来源说明
  realtime.py           实时数据采集与缓存
  comparison.py         两城配对与共享刻度
  colors.py             统一配色
  updates.py            自动更新调度
  report.py             HTML、JSON、CSV 输出
  server.py             本地 HTTP 服务
  cli.py                命令行入口
  pages.py              公共数据导出、静态构建与定时更新
  templates/            当前界面模板与资源
tests/
  fixtures/             独立的公开样本与虚拟客户端配置
data/                   本机城市配置、公开客户端配置和快照
output/                 当前生成页面与数据表
site-data/              随仓库提交的公开数据快照
.github/workflows/      测试、Pages 部署与定时数据更新
logs/                   本地服务日志
.runtime/               本机可选的 Python 运行环境
run.ps1                 Windows 启动脚本
update.cmd              双击启动入口
pyproject.toml          包信息与安装入口
```

`data/`、`output/`、`logs/`、`.runtime/` 和虚拟环境均不纳入 Git。测试不依赖这些本地目录，也不会使用真实客户端配置或访问网络。

## 开发与测试

```powershell
python -m unittest discover -s tests -v
```

测试覆盖日值校验、日期边界、统计口径、城市与地区搜索、实时缓存、更新失败保护、城市保存及两页数据一致性。`tests/fixtures/aqiin` 保留少量公开日历响应及来源摘要，供离线回归测试。

手机浏览器回归测试使用独立的开发依赖，运行时仍只依赖 Python 标准库：

```shell
npm ci --prefix tests/browser
npm --prefix tests/browser exec -- playwright install chromium
python -m aqirec.pages build
npm test --prefix tests/browser
```

测试覆盖 320、360、390、430 像素竖屏（含 360 × 640 较矮屏幕），844 像素触屏横屏及桌面；校验完整城市卡片一屏可见、日值点选、月份表三列宽度及月份固定、少量城市不膨胀、指标切换保持滚动位置、统计值／配色一致、城市弹层、拖动与键盘排序、取消恢复、刷新保留顺序、阈值排序和两页导航。CI 在 Pull Request 中自动运行这些检查。已有 Chrome 时可设置 `PW_CHANNEL=chrome` 使用系统浏览器。
