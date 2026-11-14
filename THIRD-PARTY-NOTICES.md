# 第三方组件

本项目使用 `zfdang/hongguo-open-player` 的 `src/server` 作为检索与播放组件：

- 源码：https://github.com/zfdang/hongguo-open-player
- 获取时提交：`7bea0808576fa5112d68fa91bc776df206d82508`
- 本地改动：`src/server/index.js` 允许通过 `HONGGUO_CLIENT_DIR` 指定自制界面目录。
- 播放请求格式同步上游 PR #88（`43b5e7ad746fce983ed862fa7f4919d0e84772b8`）：gzip 正文及签名、7.4.3.32 播放配置与请求头。
- 播放请求同步上游 PR #92（`3f687c5b07e04eb194141f8eeb78ded86d646024`）：`multi_video_model/player/v1` 主备接口、`dr_scene`、匿名安装标识 Cookie，以及完整的 Argus 551 / Ladon 签名。新增 `argus.js` 及其测试保留 GPL-3.0-only 声明。本地保留画质、片源选择与兼容编码逻辑，保存并复用已验证可播放的匿名设备（`data/device.json`），主备接口均返回空响应时自动更换设备重试。
- 上游仓库根目录的许可文本为 AGPL-3.0；部分源码文件标注 GPL-3.0-only。为保留上游义务，本项目按 AGPL-3.0 提供源码与许可。若需要重新分发，请核对上游每个文件的版权与许可要求。

Electron、Express 和 Axios 通过 npm 安装，各自许可见安装包中的 `node_modules` 元数据。

小说搜索、详情、目录和网站可见正文使用 `fysh1010/mcp-server-fanqie` 的部分源码：

- 源码：https://github.com/fysh1010/mcp-server-fanqie
- 获取时提交：`fd242a46d68f00dfb6d013aad0cbaaee98d148c1`
- 许可：MIT，文本保存在 `vendor/fanqie/LICENSE`；协议签名实现的第三方声明保存在 `vendor/fanqie/licenses/`。
- 本项目只使用官方网页可见的小说文字，不接入该项目的账号登录和书架功能。

公开评论预览使用 `dawei233/hongguo-drama` 的 `episode-comments.js`、`public-details.js` 和 `catalog.js`：

- 源码：https://github.com/dawei233/hongguo-drama
- 获取时提交：`c884fab6c6e36ad38173e251738b9b35f958383f`
- 许可：GPL-3.0，文本保存在 `vendor/comments/LICENSE`。
- 官网只公开部分评论预览，本项目不提供评论发布功能。
