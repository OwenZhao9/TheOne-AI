# TheOne 本地桌面版

TheOne 使用 AionUI 的界面组件，直接启动随应用携带的官方 Pi。聊天不经过 AionCore。Mu 仅作为结构参考，没有复制其代码、品牌或专属资源。

## 使用

1. 打开 `/Applications/TheOne.app`。
2. 在“设置”选择模型服务，填写有效服务密钥；如服务支持，也可选择浏览器登录。网页登录和外部链接通过 Chrome 打开。
3. 自定义服务需填写服务地址、服务格式和模型名称。图片开关应与服务实际能力一致。
4. 保存后选择默认模型，点击“发送 Hello 测试”。这里实际请求所配置的模型，失败会显示错误，不会生成替代回复。
5. 选择工作文件夹开始对话。执行中可停止、补充当前指令，或选择“完成后再发送”；待处理内容可撤回输入框。

输入 `/` 查看 Pi 发现的命令与技能，输入 `@` 搜索工作文件夹中的文件。文件也可拖入或使用附件按钮选择，剪贴板图片可直接粘贴。普通文件以路径交给 Pi 读取；图片以图片内容发送。单次最多 20 个附件，图片总大小最多 16 MB。

### ChatGPT 登录

在设置中选择 **OpenAI**，点击“使用 ChatGPT 登录”，在 Chrome 的官方页面完成授权。应用会自动接收返回结果；如果网页已授权但应用仍在等待，可以点击“粘贴返回链接”，填入浏览器最后一页的完整地址。登录后选择默认模型，再发送 Hello 测试。**OpenAI Codex (legacy)** 也保留 Pi 提供的浏览器和设备码两种登录方式，对应 Mu 当前使用的通道。

新版 OpenAI 登录需要每份安装固定的设备编号。TheOne 使用官方 Pi 的 `SettingsManager.getOrCreateDeviceId()` 在自己的 `pi/settings.json` 中创建、保存，并通过 `ModelRuntime.login()` 的 `getDeviceId` 参数传入；先保存成功才打开授权页面。取消、重启和重装应用（保留数据目录）不会重新生成编号，也不读取终端 Pi 的编号或账户。授权和凭据刷新均交给原版 Pi。此处修复了缺少设备编号导致登录立即报错的问题。

2026-10-03 登录修复验证：34 项相关自动测试通过；安装后的 `/Applications/TheOne.app` 所带运行程序再次通过 4 项授权测试。用户在 Chrome 的 OpenAI 官方页面完成 ChatGPT 授权后，登录状态在重新安装与重启后保留。应用内使用 `openai / GPT-6 Sol` 的 Hello 测试真实返回 “Hello! How can I help?”，等待状态正常结束。网页显示 Pi 是因为使用原版 Pi 的授权标识。授权过期后的自动刷新尚未实测。

本机测试发现 `openai / GPT-5.4` 被当前 ChatGPT 账户拒绝；Pi 的完整模型目录不代表账户有权使用全部模型。首次切换后出现过测试等待状态不结束，重启应用后 GPT-6 Sol 测试通过；该偶发现象的原因尚未确定，不将其描述为已修复。

2026-10-03 账户模型筛选：ChatGPT 登录后，聊天页和设置页统一通过应用授权助手查询账户模型。`openai` 使用 `https://api.openai.com/v1/models`；旧版 `openai-codex` 使用 `https://chatgpt.com/backend-api/codex/models`。只提供服务返回为可列出、且本地 Pi 已支持的模型，不维护按新旧命名猜测的列表。完整远端内容与凭据不传给界面，只传模型标识及显示所需字段。查询失败、授权失效或返回格式变化时不回退到静态订阅模型目录；设置中可刷新重试。API 密钥和自定义服务仍沿用 Pi 目录，不声称已经查询这些服务的账户权限。

本机账户查询返回的可选项为 GPT-6-Astra、GPT-5.6-Sol、GPT-5.6-Terra、GPT-5.6-Luna 和 GPT-5.5。之前实测成功的 GPT-6 Sol 此次未被列出；现有会话和默认选择保留，仅作为不可再次选中的当前值显示，用户可以重新选择。服务列表可能变化，也不保证额度或网络始终可用。旧版 OAuth 的路由有自动测试覆盖，未对旧版账户做真实登录查询验收。实现参考 [OpenAI 官方模型查询代码](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/models.rs)。

该次修改通过 49 项接入测试，覆盖账户目录交集、隐藏模型、授权失败、网络错误、空列表、账户变化、取消查询以及聊天页刷新后移除旧选项；类型、语言资源和代码检查通过。安装后的运行程序再次通过 4 项授权测试，签名完整性与打包资源一致性检查通过。实际安装界面中，聊天页和设置页均显示上述 5 个可选模型，旧选择为灰色保留；重启后的会话与未发送的 `hello` 草稿仍在。

对话菜单提供重命名、置顶和移到废纸篓。搜索同时匹配标题与文件夹。运行结束并保存消息编号后，消息旁显示另开对话按钮。选择用户消息会把文字放回新对话输入框，原图需重新添加；选择回答则保留到该回答的历史。右侧提供文件浏览、文字/图片/Markdown/HTML/PDF 预览和只读代码改动。工具完成后刷新文件列表及当前预览。

## 独立性与数据位置

- 应用标识：`local.owenzhao.aionpi`。
- 数据目录：`~/Library/Application Support/AionPi`。更名后沿用此目录，保留已有设置和对话。
- Pi 聊天记录：数据目录下 `pi/sessions/*.jsonl`，是已发送消息的唯一来源。
- `drafts.json` 仅存未发送对话的标题和工作文件夹；`pins.json` 存置顶信息。输入框草稿保存在本应用的浏览器存储中。
- Pi 凭据与模型配置：数据目录下 `pi/auth.json`、`pi/models.json`；应用默认设置在 `settings.json`。这些文件不应分享。
- `logs/runtime.log` 只记录进程启动、退出和错误状态，不记录密钥、完整聊天、工具输出或工作路径。
- 不读取终端 Pi 的密钥或模型环境变量，不导入此前无效的 DeepSeek 配置。原 AionUI 的安装、数据和后台保持独立。
- 应用没有官方 AionUI 自动更新入口，也不启动 AionCore、定时任务或远程网页服务。

## 实现与维护

Pi 的 RPC 是程序间传递指令和结果的通道，类似前台把订单交给厨房。这里由独立桌面主程序启动 `pi --mode rpc`，界面通过受限制的内部桥接调用它。

- `packages/desktop/src/process/services/pi/`：进程管理、会话文件、配置、附件和文件服务。
- `packages/desktop/src/process/bridge/piBridge.ts` 与 `packages/desktop/src/preload/pi.ts`：内部通道，只接受本应用主窗口请求。
- `packages/desktop/src/common/pi/`：实时消息与历史记录共用的转换逻辑及类型。
- `packages/desktop/src/renderer/pages/PiDesktop/`：桌面页面，复用 AionUI 的 Markdown、思考内容、命令菜单、输入样式、主题和语言管理。
- 一次实际使用的会话对应一个 Pi 进程；只浏览已存历史不启动 Pi。空闲进程会回收，重新使用时从会话文件恢复。
- 消息按递增编号补齐；等待 Pi 的 `agent_settled` 并同步保存编号后才开放分支。Pi 的源码和协议未被修改。

不包含 Mu 的判断模型、长期经验库、多助手协作、工作看板、目标循环、浏览器工具或旧式定时任务。完整会话树、撤销文件修改、代码提交和远程访问不在本次范围内。

## 构建

应用图标、侧栏与首页使用用户最终选定的暖橙色数字 1 Logo，原图为 `design/theone-logo/theone-icon-warm-orange-v1.png`，透明背景版本为 `design/theone-logo/theone-icon-warm-orange-transparent.png`。仅移除了圆角外侧与边界连通的棋盘格背景，标志内原有颜色像素保持不变。界面资源位于 `packages/desktop/src/renderer/assets/logos/brand/theone.png`；打包前 `scripts/aionpi/prepare-icon.mjs` 将它转换为 macOS 所需的各尺寸图标。原 AionUI 图标资源保持独立。

Node.js 是运行 JavaScript 程序的环境，像 Pi 的发动机。开发构建使用本机 22.22.2；安装包另外携带同版本的官方独立运行程序，因此用户无需打开终端。

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
cd /Users/owenzhao/TheOne/pi
npm run build:offline
cd /Users/owenzhao/TheOne/aion-pi
bun install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
bun run aionpi:runtime
bun run aionpi:package
```

产物为 `out/aionpi/mac-arm64/TheOne.app`，适用于本机 Apple 芯片 Mac。准备脚本使用本地 Pi 构建产物，并按官方校验值验证所携带的 Node.js。版本、Pi 提交编号与校验值在安装包资源目录 `aionpi-runtime/versions.json`。开发时可运行 `bun run aionpi:dev`。

打包流程会拒绝 ad hoc（临时）签名，因为它会让 macOS 把每次更新当成不同应用，重复询问“想访问文稿文件夹中的文件”。默认从本机钥匙串中确定性选择 Developer ID Application，其次选择 Apple Development；也可以用完整证书名称或指纹固定选择：

```sh
export AIONPI_CODESIGN_IDENTITY='Apple Development: Ning Zhao (DBU95WNFXA)'
bun run aionpi:package
```

本地 Apple Development 签名用于同一台 Mac 的持续更新，不能替代面向其他设备发布所需的 Developer ID Application、公证和分发流程。没有稳定签名证书时打包会明确失败，不会悄悄退回 ad hoc。AionUI 的 Apache-2.0、Pi 的 MIT 与 Node.js 的许可证随应用保留，详见仓库 `LICENSE`、`NOTICE` 和资源目录。

## 验证与边界

### Skill 型 Bot 广场

左侧“Bot 广场”可从本地 Bot 文件夹或公开 GitHub 仓库/文件夹链接导入，预览后确认安装。支持搜索、分类、收藏、更新和移除。使用时可直接开始对话或选择工作文件夹，复用 TheOne 的模型和聊天界面；Bot 会话加载指定 Skill 和职责说明，重启及分支保持绑定版本。已有聊天不随 Bot 更新而改变。Computer Use 已通过 Cua Driver 接入；驱动未安装或未就绪时，声明依赖该能力的 Bot 可保存到广场，但不会开放启动。

2026-10-04 验证：71 项 Pi/Bot 自动测试通过，类型及语言资源检查通过，安装包签名验证通过。安装版已检查广场、导入预览、来源确认、本地包更新和创建 Bot 对话；安装版 Bot 对话通过实际 GPT-6 Sol 读取写作 Skill 及检查清单，界面显示真实结果“我们明天下午三点开会讨论项目进展。”，等待结束并显示用量。GitHub 下载的成功路径、分支与子目录、非法链接及错误提示已通过受控网络测试；真实公网验证了缺少 bot.json 的提示，尚未用第三方公开 Bot 仓库做成功导入验收。

开发者交付规范、字段表、GitHub 链接格式、工具能力约定与现有限制见 [Bot 接入文档](./bots/README.md)。[写作助手示例](./bots/writing-bot/) 可直接复制修改或本地导入。导入不执行脚本、不自动安装依赖、不将模型凭据发送给 GitHub，也不为未接入的能力生成替代结果。

### AI 情报文章库

左侧“文章库”集中显示 AI 情报 Bot 归档的 Markdown 文章。列表支持按标题、摘要、主题和年份筛选；卡片显示摘要、标签、预计阅读时间与来源数量。点击卡片后在 TheOne 内进入阅读页，外部来源链接统一用 Chrome 打开。

文章库默认读取 `$HOME/getinfo/documents/ai-intelligence`，该目录不存在时使用应用数据目录中的 `ai-intelligence`。开发和迁移时可用 `THEONE_ARTICLE_LIBRARY` 指定其他目录。读取接口只接受库内 Markdown 文件并拒绝父目录跳转和指向库外的符号链接。

```sh
bun run aionpi:test
bun run aionpi:smoke
node scripts/aionpi/ui-journey.mjs
AIONPI_TEST_APP=/Applications/TheOne.app/Contents/MacOS/TheOne node scripts/aionpi/ui-smoke.mjs
AIONPI_TEST_APP=/Applications/TheOne.app/Contents/MacOS/TheOne node scripts/aionpi/ui-journey.mjs
```

自动测试在独立临时目录运行真实 Pi，使用专用本地测试服务检查指令传递；测试服务不会被打包，也不会作为失败后的替代模型。检查涵盖文件读写与修改、图片传递、停止与排队、进程异常退出、断网、登录失败、重启恢复、对话分支、交互问题及中文消息。界面检查另覆盖设置表单、预览更新、输入恢复与应用重启。

**真实模型 Hello 已验收**：2026-10-03 在安装后的应用中通过 ChatGPT 授权账户与 GPT-6 Sol 获得真实回复，等待状态正常结束。真实图片理解、其他服务的网页登录及授权到期后的自动刷新仍需分别验证，不能以本地测试回复代替。

2026-10-03 本机验证结果：27 项接入自动测试通过，另有 82 项已有主题和语言相关测试通过；类型检查、语言资源检查及代码检查均无错误。安装后的应用通过了完整界面流程，包括未配置时发送失败、配置服务后继续同一对话、文件工具、代码改动、分支、停止、输入恢复和重启。原 AionUI 与 TheOne 已同时运行，安装包签名完整性检查通过。测试截图位于 `output/playwright/`，没有把测试服务或测试凭据放进正式应用的数据目录。

参考：[Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)、[Mu 原生连接结构](https://github.com/qybaihe/mu/blob/main/desktop/docs/native-host.md)。

2026-10-04：普通“新建对话”不再弹出文件夹选择器；另提供“选择文件夹新建”。Bot 提供“直接开始对话”。未指定目录时创建独立的持久工作目录，历史记录显示为“普通对话”，且不列入最近项目文件夹。

该改动验收：73 项 Pi/Bot 测试通过；类型、语言资源与安装签名检查通过。安装版点击“新建对话”直接进入“普通对话”，未弹出文件夹选择器。

2026-10-04 会话切换修复：加载另一会话时立即隔离旧快照，忽略迟到的旧请求，避免显示上一段消息。新对话立即提供已配置的默认模型；模型列表提前加载，账户目录请求合并并在内存中复用 60 秒，登录、退出和服务配置变更时清空。77 项 Pi/Bot 测试通过，覆盖会话切换、迟到失败、默认模型和目录缓存失效。

2026-10-04：新会话复用已加载的模型目录；思考强度选项按模型缓存，仅展开时向 Pi 查询，不再为打开空白会话启动 Pi。默认思考强度为中等，由 Pi 按模型能力调整。历史侧栏忽略无消息、无运行任务且无文字/附件草稿的会话，不删除底层记录。80 项测试通过，包含跨会话不重复加载及草稿保留。

选择文件夹新建的入口位于输入框内部左上角、输入文字区域上方，左侧全局导航仅保留普通新建对话入口。此位置调整尚未测试或打包，等待统一验收。

### Computer Use 与 Jev

设置中的“Computer Use（电脑操作）”用于检查、启动 Cua Driver，并引导授予 macOS“辅助功能”和“屏幕录制”权限。TheOne 把 `computer` 工具直接注册到 Pi，因此普通对话和 Bot 使用同一条真实桌面操作链路。驱动缺失、未运行或权限不足时会明确报错，不会假装已经点击或读取屏幕。

2026-10-04 连接修复：同一 Pi 进程保持一个 Cua 连接，不再每次操作都重新启动连接，保证观察所得的截图和按钮标识可以用于后续动作。工具返回保留窗口编号等结构化信息和截图，失败时传回实际原因；权限检查兼容当前驱动的布尔字段。重复打开应用时，未取得单实例锁的进程直接退出；服务清理失败也不会阻止应用退出。安装前保留旧应用副本，再完整复制新应用，避免覆盖复制留下旧文件破坏签名。

本次验证：隔离副本的完整测试为 546 个测试文件通过、1 个跳过；5109 项测试通过、5 项跳过，类型检查通过。打包版的首页、设置和新建会话检查通过，无界面运行错误；安装签名检查通过，重复启动仅保留一个主进程。由安装后的 TheOne 对话调用自己的 `computer` 工具找到微信，并获得精确窗口前台验证；随后使用同一会话的截图编号点击标题栏空白处，再次读取同一窗口成功。点击返回 `effect: unverifiable`，表示驱动执行了动作但空白处没有可独立核对的内容变化，不将其表述为可见效果已验证。此验收不包括发送消息、付款、订票或 Jev 主动拦截效果。

Jev 是一个专门做判断的模型。本项目复用了 mu 中 `@kyrn/judge` 的 System One 协议和三段式判断思想：明确支持、明确拒绝、中间不确定。设置 TypeSafe API 密钥后，`jev_judge` 可在选航班等场景比较候选方案；“只观察”模式记录判断但不拦截动作，“不确定时拦截”模式在判断未通过时直接返回失败。按用户要求，电脑操作不再弹出逐步授权确认框；已明确授权的任务直接执行，不重复询问。移除弹窗不代表获得用户未授予的任务权限，也不改变 macOS 自身的辅助功能和屏幕录制权限。判断记录只保存结果和输入摘要，不保存 API 密钥或完整候选内容。

2026-10-04 取消额外确认：删除 `Allow this computer action?` 弹窗的调用，而非隐藏界面。原逻辑扫描所有参数，任务名称 `wechat-send-morning-20250215` 中的 `send` 也会让只读的 `list_windows` 触发确认；只读操作现在不参与该风险标记。测试覆盖带此任务名称的窗口查询、包含发送标签的动作、Jev 同意及失败场景，均不请求额外弹窗确认。

### 2026-10-04 原版 AionUI 界面重新接入（代码完成，待统一验收）

TheOne 的界面控制层仍使用 Pi 原生通道；窗口布局和对话展示改为实际复用 AionUI 源组件。原版页面和 TheOne 共用同一份抽出的展示组件，避免维护另一套仿制布局：

- `components/layout/Layout/LayoutFrame`、`Titlebar/TitlebarFrame`：原版窗口骨架、标题栏、侧栏尺寸和布局样式。
- `SiderToolbar`、`SiderItem`、`SiderFooter`：原版新建入口、会话行和设置入口。搜索入口位于标题栏，仍支持标题和文件夹检索；空会话过滤与草稿保留逻辑沿用现有实现。
- `guid/components/GuidPageFrame`、`GuidInputCard`、`GuidSendButton`：原版居中欢迎页和输入卡片。文件夹入口按用户要求放在输入框内部左上角。
- `ChatLayout/ChatSurface`、`ChatTitleEditor`、`SendBox/SendBoxSurface`：原版聊天标题、内容布局和聊天输入框。欢迎页转为对话时保留同一个输入控制层，避免丢失发送失败恢复的数据。
- `MessageText/MessageBubble`、`MessageThinking`、`MessageToolGroupSummary`、`runtimeSelectorOptions`：原版消息气泡、思考内容、工具执行卡片、模型和思考强度选择。Pi 消息仅转换为展示所需字段，不更改会话文件格式或模型权限来源。

保留 TheOne 名称及现有标志。`PiDesktop/BotPlaza/`、Bot 导入接口、安装格式、版本绑定与运行服务未改动，Bot 接入文档保持不变。Pi 会话与认证服务同样未改动。仅展示当前接通的入口，不显示 AionCore 的多引擎、定时任务等不可用功能。

按用户要求，本轮未运行测试、类型检查、打包、安装或应用重启；此前记录的验证结果不代表本轮界面已通过验收。安装版仍是此前版本。
