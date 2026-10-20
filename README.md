# AQIRec · 城市 AQI 年度概览

基于 AQI.in 美标日值的本地空气质量网站。支持城市与地区搜索、实时 AQI、过去一年的日历热力图，以及两城共同日期的差异对比。

Python 3.10+，运行时仅使用标准库。页面资源随程序提供，无需前端构建。

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
| 城市日历 | `/` | 实时 AQI、城市勾选、日历热力图、日值累计分布和阈值占比 |
| 差异对比 | `/compare` | 两城共同日期的原值与差值、月均差距及累计分布 |

- **搜索与管理**：支持常见中文名和英文名；城市可加入日历，地区可展开平台匹配的下辖城市。比如“东京”“东京都”“Tokyo”会区分显示地区与城市。地区级结果本身不作为城市日值参与统计。
- **勾选与排序**：勾选决定展示和更新范围，选择会保存；城市右侧的 × 删除已保存的城市。取消勾选保留该城市配置。
- **累计分布**：城市日历按各城自己的有效日值计算天数和占比；滑块或 ≤50、≤100 快捷按钮可查看阈值读数。
- **两城比较**：仅统计双方都有已发布日值、且非今日暂定的同一组日期。切换组合时使用共享色标。
- **实时数据**：后台约每 5 分钟尝试刷新，页面每 30 秒读取。失败时保留并标记可用的旧值，跨日旧值不冒充今日实时值。
- **每日更新**：北京时间 00:05 为已勾选城市尝试获取历史日值；平台未发布或请求失败时自动重试。服务恢复运行后会检查到期任务。

## 数据与统计口径

采用 AQI.in 官方日历接口的 `sensorname=aqi`，对应平台标注的 AQI (US)。日值和日期标签直接保留；平台日聚合时区与算法未独立核验。

默认区间为截至昨天的 365 个日期，随日期自动滚动。期间和月度均值按有效日等权计算；缺失不补零、不插值。AQI≤100 占比的分母为有效日数。跨年同名月份分别统计。实时 AQI 独立保存，不进入历史日值和均值。

原始响应、来源 URL、获取时间及 SHA-256 保存在本地快照中。页面目录中的 `source-policy.md` 和 `report.json` 提供当前覆盖范围与来源摘要。

来源：[AQI.in](https://www.aqi.in/cn/air-quality-map)。

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
  templates/            当前界面模板与资源
tests/
  fixtures/             独立的公开样本与虚拟客户端配置
data/                   本机城市配置、公开客户端配置和快照
output/                 当前生成页面与数据表
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
