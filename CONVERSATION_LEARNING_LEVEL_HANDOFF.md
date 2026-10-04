# TheOne 会话学习水平交接记录

- 工作目录：`/Users/owenzhao/TheOne/conversation-learning-level`
- 分支：`feat/conversation-learning-level`
- 起点：`0b835130044005afe738f600aaca92eef1139a09`
- 2026-10-04：用户已确认仅要每会话手动设置版本，并授权主任务整合验证。主任务已接管本分支收尾，不实现自动学习升级。代码将本地提交并合入独立整合分支，不上传、不打包、不安装，不修改 Computer Use 工作目录。

## 用户目标与约束

每个会话独立保存当前主题的熟悉程度，可手动设置并影响实际回复；不同会话不可共享水平。设置、变化、历史重开和分支恢复要一致。保留现有 AionUI 界面、Bot 广场、GitHub Bot 导入、Bot v1 格式和 Pi 运行绑定；不调整用户选择的模型或思考强度。不静默启用自动升级，不记录会话全文或密钥；暂不测试、打包、安装、提交、推送或合并。

## 已作决策

- 当前先实现用户手动设置：初学者、熟悉、专家、自定义。
- 设置保存于 TheOne 数据目录的 `learning.json`，旧会话缺失时默认使用“熟悉”；草稿只作兼容载体，侧车文件优先，避免写入中断后回退。
- Pi 没有发现动态替换系统指令的 RPC，因此每次会话运行时通过已有 `--append-system-prompt` 接入学习指令；修改空闲会话时关闭当前运行时，下次发送用新指令启动。运行中、同步中或有确认框时返回 `session_busy`，不强行打断。
- Bot 自带的附加系统指令保留，并与学习指令合并；不改 Bot v1 绑定逻辑。
- `PiLearningAdjustmentSource` 已区分 `manual`、`suggestion`、`automatic`，但本次只允许并写入 `manual`。Jev 只适合后续做有证据的分类/评分和置信度门控，不能生成教学正文；自动升级策略仍待用户决定。

## 实际改动

- `packages/desktop/src/common/pi/learning.ts`：学习档案类型、默认值、校验、回复风格系统指令。
- `packages/desktop/src/common/pi/types.ts`、`index.ts`：会话档案和 IPC `setLearning` 契约。
- `packages/desktop/src/process/services/pi/SessionStore.ts`：学习档案读取、原子保存、删除和历史/草稿恢复。
- `packages/desktop/src/process/services/pi/PiService.ts`、`packages/desktop/src/process/bridge/piBridge.ts`：Pi 指令接入、空闲运行时重启、分支继承和 IPC。
- `packages/desktop/src/renderer/pages/PiDesktop/LearningLevelControls.tsx`、`components/NativeConversation.tsx`：复用现有 AionUI/Arco 组件，在欢迎区和会话标题栏提供设置入口。
- `scripts/aionpi/locales.mjs`、`scripts/aionpi/traditional.mjs`、13 个 `common.json` 和生成的 `i18n-keys.d.ts`：新增多语言文案。
- `tests/unit/pi/learning.test.ts`、`tests/unit/pi/sessionStore.test.ts`：后续统一运行的聚焦测试。

## 未完成与待验证

- 自动调整不属于用户最终确认的本次范围，无需再次确认；没有实现或启用 Jev 学习水平评估。
- 主任务整合验证：21 项针对性检查通过，覆盖档案校验、保存失败不生效/可重试、不同会话隔离、历史替换草稿、删除、界面选择保存/失败/切换隔离、运行中禁改、保存期间禁止发送、Bot 指令合并、真实 Pi 请求、重启与分支继承。另有 TypeScript 检查通过。
- Pi 检查使用安装包的真实 Pi 进程和临时目录内的本地测试接口，确认实际请求中的系统指令；没有调用真实在线模型，不能据此声称回答质量已验收。未打包、安装或上传。
- 已执行 `bun run i18n:types` 与 `node scripts/check-i18n.js`；i18n 检查通过。
- 曾误用 `bunx oxfmt --check`：工具自动下载了格式化工具依赖到本地缓存；未修改仓库 lockfile、依赖或应用安装状态。之后未再调用会下载依赖的命令，也未删除共享缓存。

## 可能与其他分支重叠的文件

本分支直接改动了 Pi 桌面入口、Pi 类型/服务、Bot 启动参数拼接附近、TheOne i18n 生成脚本及全部语言 `common.json`。其他任务若同时改这些文件，合并时应按功能保留双方改动，特别检查 `PiService.ensure`、`SessionStore.load/refresh`、`NativeConversation` 和 `scripts/aionpi/locales.mjs`；不要覆盖 Bot 广场或 Bot v1 逻辑。

## 下一步

1. 本次只整合用户已确认的手动版本。
2. 在独立整合分支复核，并记录实际界面检查情况。
3. 打包、安装和 GitHub 上传仍等待用户安排；已安装应用不会因此改变。

## 整合修正

- 仅在学习设置原子保存成功后更新内存；保存失败时保持旧值。
- 设置编辑器按会话编号隔离，切换时不遗留旧选择，旧请求的迟到结果不影响新会话。
- 保存设置时阻止并发启动请求，运行中或启动中的 Pi 不被设置操作打断。
- 新测试位于 `tests/unit/pi/learning/`、`tests/integration/pi/learning.test.ts`；复用已有 Bot 和会话检查，不运行全仓测试。

## 整合结果（2026-10-04）

- 功能提交：`716efcd3a`；合并提交：`0630bf05d`。已无冲突合入 `integrate/conversation-learning-level`，并更新本地主开发分支 `codex/aion-pi`。未上传 GitHub。
- 整合目录：`/Users/owenzhao/TheOne/integration-learning`，基线 `aab07c7b3`。没有改动 Computer Use 工作目录的代码或分支。
- 合并后重新运行 6 个相关测试文件，21 项全部通过；没有运行全仓测试。类型、语言、格式检查通过，相关文件 lint 为 0 errors。
- 实际打开隔离数据目录的开发版窗口：中文设置正常显示；初学者设置保存并在重新加载后保留；新会话仍为默认熟悉；自定义内容为空时不能保存，填写后成功保存。
- 开发启动成功编译主进程与预加载代码。没有生成安装包，没有安装新应用。验证窗口已关闭。
- 使用安装包中的真实 Pi 和本地测试接口验证请求指令、Bot 合并、模型和思考强度保留、停止与恢复。没有调用真实在线模型，回答质量仍待验收。
- 已安装的 `/Applications/TheOne.app` 保持原样；个人模型凭据与聊天记录没有被验证流程读取或修改。
- 本次未合入任务树、官网、Computer Use 的进行中修改。后续需要另行安排 GitHub 上传、打包安装和真实模型效果验收。
