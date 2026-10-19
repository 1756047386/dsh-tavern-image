## 可复制的 Issue #18 回复（中文）

感谢反馈。针对发布更新和移动端问题，本次已完成以下发布流程与文档变更：

- **发布资产**：发布流程在测试通过后生成独立的 dsh-tavern-image-source.zip、保留现有双击安装格式的 dsh-tavern-image-install.zip，以及 SHA256SUMS。清单采用标准 SHA-256 行格式。源码 ZIP 是更新资产；更新器先核对清单摘要和宿主兼容版本，再替换插件文件。
- **版本门禁**：发布准备脚本核对 Git tag 必须严格为 v<package.json version>，并要求源码包中的 dsh.compatibility.tavernApiVersion 是 1 至 Number.MAX_SAFE_INTEGER 之间的 JSON 安全整数。当前源码 package.json 已声明 tavernApiVersion: 1；校验脚本拒绝缺失、非数字、非整数、小于 1 或超出 Number.MAX_SAFE_INTEGER 的值。
- **安装与更新边界**：离线安装包适合首次安装/迁移；已有 Git 安装先检查改动，再 fast-forward；ZIP/内置更新从 GitHub Release 获取源码资产，不执行 Git 更新。Tavern 集成方只在插件目录首次缺失时安装，不覆盖已存在目录。升级后要完整重启宿主。
- **凭据存储**：目前密钥保存在插件配置文件中，界面不回显，留空保存保留旧值，显式清除才删除。本次未能核实可供插件使用的 DSH/Tavern OS 密钥库公开接口，也没有进行系统钥匙串迁移。我们建议宿主提供 profile 隔离、版本化的 getSecret / setSecret / deleteSecret API，并确保普通配置/状态接口和日志不返回密钥；宿主契约建立前仍使用现有配置存储。
- **手机与 Android**：源码有移动 viewport、自适应网格和部分触摸交互，但本次没有真机或手机浏览器验证，也不能据此承诺 Android 内嵌 Tavern 支持。内嵌运行还取决于宿主的 Node 插件运行时、文件持久化和插件 API；桌面服务配合手机浏览器则依赖主机网络可达。窄屏表单、触摸缩放/拖动和实际宿主兼容性仍需设备验证。

版本 tag 推送后，发布工作流会运行测试、打包并创建 Release。Android 实测及宿主凭据接口迁移仍待支持与验证。
