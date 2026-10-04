# Automatic delegation and task tree

TheOne uses the existing Pi conversation UI for a persistent hierarchy of parent, child and grandchild conversations. The composer offers delegation for the current input (including attachments), and Pi can use `delegate_tasks` when work benefits from separate specialists.

## Decisions and resources

The agent receives the installed Bot and skill catalog. Its proposed tasks include scope, reasons, expected files, acceptance criteria, dependencies and relevant resource candidates. The configured Jev classifier receives the actual candidate catalog and judges the plan. Unavailable credentials, failed classification, unsupported candidates or a rejected decision leave the work unresolved; another judge is not silently substituted.

Remote skills require a configured HTTPS registry, compatible metadata, an allowed license, integrity digest and explicit approval. They are isolated from Pi's automatic global scan. Revocation or unavailable registry evidence prevents reuse through a same-name local fallback. Settings supports approval and revocation.

## 开工前调研与用户确认

新派出的每个子任务（包括继续派出的孙任务）先进入调研阶段。明确的网站开发请求会先请求拆分适合独立执行的前端、后端；原有 Jev 分派判断、资源检查与依赖规则保留。

- 网上案例和 Skill 候选通过 GitHub 实时查询；Skill 候选进一步检查实际 `SKILL.md` 路径，并优先匹配任务关键词。界面列出来源、许可信息和是否已获授权，可在 Chrome 打开来源。
- 子会话使用没有执行工具的 Pi 进程整理比较结果、推荐方案、实施步骤及验收方式。不会加载 Bot 执行扩展、电脑操作、MCP、自动分派或文件修改工具。调研模型调用仍计入现有共享预算。
- 缩进任务树显示“查找案例和技能”“等你确认”“调研需重试”。子会话中可选择“同意并开始”，或填写修改意见、可选查找关键词后重新调研。
- 用户批准具体版本后关闭调研进程，再按原有依赖规则启动执行进程。方案修改会产生新版本并重新等待确认；旧版本、重复批准、失败调研、停止/失效任务不能直接开工。重启不会自动批准。
- 调研不提前复制项目基线；批准并满足依赖后再准备项目副本，包含父任务已验收的依赖文件。
- 新找到的 Skill 是可审阅的候选，不等于已安装、兼容或有权复制。现有远程 Skill 的授权安装规则保持有效；方案批准不会跳过这些检查。网络失败或没有结果会明确呈现，不编造来源。
- 本次新增界面只提供中文，依用户要求不扩展多语言。原有历史任务保持原状态，不对正在执行或已完成的旧任务追加确认步骤。

## Work and integration

Children work in independent project copies with private Git metadata and Pi state. A child's snapshot is prepared when it starts, so a dependency's accepted changes are present. On the current macOS target, an inherited OS write policy protects parent and sibling files without prohibiting ordinary shell builds or tests. A parent can inspect its descendants' workspaces; the reverse write access is not granted.

A finished assistant turn is evidence, not acceptance. The parent reviews the criteria, changed files and checks, then invokes `verify_task` with concrete evidence; the user can also record a review from the sidebar. Acceptance integrates declared files into the direct parent's workspace. The integration checks baseline hashes, refuses conflicts and symlink targets, preserves unrelated parent edits, and supports retry. Only verified dependencies unlock subsequent work. User modifications invalidate dependent results and require review.

## Execution and persistence

Depth, total tasks, concurrency and model-call/input/output/optional cost limits are shared across the tree. Every provider request reserves a call before it starts, including iterative tool use, reports and delegation judgments. Pi usage is accumulated without inventing missing prices. Token/cost thresholds prevent subsequent requests; they are not a prediction of the cost of an in-flight response.

Recursive delegation does not hold the root creation lock or a parent execution slot while waiting for descendants. Each final settlement reports to its direct parent, including turns resumed by descendant reports. A report failure does not block later reports. Stopping a subtree aborts active Pi work. After restart, interrupted turns wait for confirmation rather than replaying automatically.

Task metadata is stored in `task-tree.json`; Pi transcripts remain the message source, including child session subdirectories. The sidebar renders the hierarchy with indentation, expansion and status controls. The root project's `.theone/task-plan.md` has nested checkboxes and `.theone/task-delivery.md` records evidence and unresolved work.

## Verification boundary

The targeted tests cover the real Pi transport with a deterministic local endpoint, OS file protection, real npm builds, merge conflicts, recursive workspace integration, budget gates, stop/recovery, skill trust and the affected UI. They are not live Jev/model-quality acceptance. Packaging, installation and the website are outside this repair-and-merge request. See `AGENT-TASK-TREE-HANDOFF.md` for test logs and release status.
