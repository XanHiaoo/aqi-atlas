# AQI Atlas · 微信原生小程序

以网站手机版为母版：蓝白配色、无阴影、五个底部入口、紧凑全年日历、日值浮层、三列月份表、城市管理与排序。此工程位于 `feat/wechat-miniprogram` 分支，当前网站主分支不受影响。

## 当前可运行内容

- 内置已有的 AQI.in 公开真实数据快照；本地完成日历、实时快照、月历、统计和两城对比计算。
- 良好日占比显示“良好天数 / 实际统计天数”；中位数不重复显示天数。统计使用与网站一致的共同有效日期。
- 城市选择、删除、重新添加、顺序、对比城市均本地保存。城市历史按 key 分开缓存，避免单条存储过大。
- 直连适配器从用户手机请求 `www.aqi.in` 和 `apiserver.aqi.in`，不经过本项目服务器或 GitHub 转发。
- 历史范围按北京时间滚动为昨天结束的 365 天；实时值不计入历史统计。前台进入、恢复、下拉刷新和日期变化时尝试更新；关闭后不持续采集。
- 鉴权配置从公开页面解析，不执行网页脚本，不打包本机缓存 token、账号信息或私密 API key。
- 失败时保留已有数据；显示“快照”或“上次数据”，不会把缓存伪装为已更新的实时数据。

## 在微信开发者工具中打开

1. 微信扫码登录开发者工具。
2. 导入此目录 `miniprogram/`，选择你的 AppID 或工具提供的测试号，填入 `project.config.json` 的 `appid`。仓库中故意留空。
3. 使用 WebView 渲染器（当前配置），进行编译和模拟器检查。
4. 需要联网时配置 request 合法域名：`https://www.aqi.in`、`https://apiserver.aqi.in`。是否能以当前小程序主体配置这两个第三方域名，需要在平台实际确认。

开发工具中的“不校验合法域名”只适合本地验证，不能据此认定正式发布或真机直连可用。正式发布仍需微信平台允许的域名配置及数据源允许的客户端访问方式。

## 尚需用户介入的验证

- 本机开发工具目前未登录，且尚无 AppID／测试号，未完成微信模拟器和真机验证。
- 当前执行环境访问 AQI.in 公开客户端配置页返回 **403**；未鉴权接口返回 **401**。不能据此宣称实时直连已成功。
- 需先登录并提供测试号／AppID，再验证真实微信请求。若仍被拒绝，需要数据源提供允许客户端使用的有效鉴权方式；不应把仅供服务器保管的私密密钥放进客户端。
- 工程保留直连模式，没有为了绕开限制增加代理服务器；联网受限时可继续查看已有真实快照。

## 开发与测试

代码只使用微信原生 API，不需要安装运行时 npm 依赖。

```powershell
# 从仓库公开快照重新导出数据（不读取 data/ 下的客户端配置）
python miniprogram/scripts/export_data.py

# 数据、网络适配器、缓存和原生 Page 交互
node --test miniprogram/tests/core.test.cjs miniprogram/tests/pages.test.cjs

# 使用已安装微信工具的 WXML / WXSS 编译器
python miniprogram/scripts/check_compile.py --tools 'D:\SoftWare\wechat_devtools_2.02.2608070_win32_x64'

# 先安装仓库现有浏览器测试依赖及 Chromium，再做编译模板的布局检查
npm --prefix tests/browser ci
npx --prefix tests/browser playwright install chromium
node miniprogram/tests/layout.spec.cjs
```

布局检查使用真实 WXML 编译器输出的虚拟节点树和原生页面的计算结果，在 Chromium 中检查 320／390／430 像素布局，并独立核对 RGB 与网页 OKLab 配色；**它不是微信运行时或真机测试**。截图输出到 `.runtime/miniprogram-qa/`，不作为发布代码。

`config.js` 只包含公开域名和刷新配置。正式上传前，重新导出最新公开快照，核对数据源授权、AppID、基础库和合法域名，并在微信模拟器与真机验证后再上传。
