# 来源与许可证记录

## 网页幻灯片工作流

- Skill：[`frontend-slides`](https://github.com/zarazhangrui/frontend-slides)
- 采用版本：`9906a34d640d2111f724544cbc50f7f130569ae1`
- 获取时间：2026-10-04
- 采用内容：固定 1920×1080 舞台、`.active` / `.visible` 幻灯片切换、键盘/触控/滚轮导航、低密度演讲稿布局、Signal 视觉系统、减少动态支持与本地编辑入口。
- 许可证：该仓库根目录 [`LICENSE`](https://github.com/zarazhangrui/frontend-slides/blob/9906a34d640d2111f724544cbc50f7f130569ae1/LICENSE) 为 MIT。完整来源副本仅保留在本地 `references/frontend-slides/`，不随正式交付提交。
- 选用样式：Signal。完整设计说明来自 `bold-template-pack/templates/signal/design.md`；在 CJK 内容中按其规则使用 Noto Sans SC，保留深海军蓝、米白、古金、细线分隔、80px 暗网格与编辑型排版。

## TheOne 项目素材

以下图片均从当前 TheOne 工作目录复制到 `presentation/assets/`，页面只用相对路径：

- `design/theone-logo/theone-icon-ice-blue-v1.png` → `assets/theone-icon-ice-blue-v1.png`
- `design/theone-logo/theone-icon-v1.png` → `assets/theone-icon-v1.png`（保留备用品牌资源）
- `resources/screenshot_1.png` → `assets/aionui-home.png`，真实 AionUI 主页/会话入口截图
- `resources/screenshot_2.png` → `assets/aionui-files.png`，真实 AionUI 对话与文件工作区截图

这些素材来自项目自身版本库；本稿没有引入外部题目、外部音频或伪造产品截图。流程图、任务树和对比表均为解释性示意，并在讲稿与页脚中按语境说明。

## 事实边界

内容依据当前分支源码、`docs/guides/aionpi.md`、`docs/prds/conversations/agent-task-tree.md`、相关提交记录与 `/Users/owenzhao/TheOne/releases` 发布记录整理。未编造用户数、收入、速度倍数、竞品测量数据或云服务上线状态。

- 自动分派、缩进任务树、子任务隔离工作目录与父任务验收：源码已有对应模块；完整自动链路与统一安装端验收仍按当前交接记录保守表述。
- 新增“先找网上案例和真实 Skill 来源、展示方案、等待用户同意才执行”：模块及交界验证已完成，但尚未打包进当前安装应用，因此讲稿和页面不把它表述为已完成安装端验收。
- Computer Use 的有界 Jev 循环有最近提交，但不把它误称为安装端全部验收。
- 火山 Seedream 5.0 Flash 已完成真实单图验证及应用配置，但不以单图成功宣称完整自动分派→生图→父任务接收链路全部验收。
- 官网在线服务和 Windows 版不列为已有上线能力；官网任务负责后续 `/presentation/` 接入与在线发布。

## 字体依赖

正式页面通过 Google Fonts 加载 `DM Sans`、`IBM Plex Mono`、`Noto Sans SC` 和 `Source Serif 4`。断网时仍可播放，但会使用 CSS 回退字体，视觉会有所变化；项目 Logo 和截图已随目录保存。
