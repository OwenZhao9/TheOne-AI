# Task tree integration handoff (2026-10-04)

The user explicitly authorized repair followed by local merge. The original paused delivery is preserved at `feat/agent-task-tree` commit `2004aa583`; repairs are on `integrate/task-tree-repair`, based on desktop `134c286ea`. The website branch is excluded.

## Current implementation

- Existing AionUI conversation, composer and sidebar components expose real Pi child conversations, recursive indentation, expand/collapse, stop/resume, and evidence-based acceptance. Bot plaza, learning controls and Computer Use integration remain present.
- Each child gets an independent project copy and independent Git metadata. Dependency snapshots are taken when work starts, after required parent acceptance. Descendants have their own nested workspaces. On macOS, a process policy permits writes to that child's project, private runtime state and session directory; this applies to shell subprocesses as well as Pi tools. Normal npm/build commands are allowed. The former command-regex guard is removed.
- Acceptance checks the original file baseline against the current parent, integrates only declared output paths, and refuses conflicting edits and symlink targets. Nested child output is accepted into its direct parent first. Failed acceptance leaves the task unverified. Workspace copies and evidence are retained for review.
- A desktop-owned request ledger reserves each model call before sending it, including parent turns, child tool loops, delegation Jev calls and report turns. Input/output usage and optional cost come from Pi's returned usage; the app does not fabricate missing costs. Limits are checked before subsequent calls; an already-running response can exceed a token/cost threshold and prevents further calls. Unfinished requests with unknown cost remain unknown after restart.
- Root dispatch locks protect creation only, rather than waiting for child completion. Waiting parents release execution slots, and child reports can resume them. Reports after recursive work are delivered from the settlement path; one failed delivery does not poison later reports.
- Remote skills stay outside Pi's global skill auto-scan. Revocation closes affected running children and invalidates dependent work. Known remote names cannot fall back to local copies. Registry/download redirects fail closed, with bounded response bodies and timeouts.
- `.theone/task-plan.md` contains nested checkboxes; `.theone/task-delivery.md` records criteria, evidence, state and usage. These are generated in the root project.
- The stronger beginner instruction from `fix/beginner-response-guidance` is included. Its real-model sample report remains `/Users/owenzhao/TheOne/learning-guidance-verification.txt`.

## Verification and limits

Targeted checks use the installed Pi runtime with temporary data and a local model fixture; they do not use or replace live model replies. Coverage includes real Pi write/edit/read in a sandboxed child, file acceptance, session restoration, per-request budget gating, stop/interrupted recovery, workspace conflict/symlink checks, a real npm build, remote skill trust, parent acceptance/dependencies, report queue recovery, sidebar nesting, Bot plaza and learning instruction transport.

The current focused run passes 35 tests across 9 relevant files; type checking and locale checks pass. Lint reports warnings but no errors.

See `/Users/owenzhao/TheOne/task-tree-repair-tests.log`, `task-tree-repair-typecheck.log`, `task-tree-repair-i18n.log`, and `task-tree-repair-lint.log` for current results.

Not performed: full-suite tests, packaging, installation, GitHub upload, website merge or deployment. The installed `/Applications/TheOne.app` remains the previous `134c286ea` release. Live Jev decision quality and a full real-model App → frontend → logo scenario have not been accepted by this verification. A configured compatible Jev classifier is required; no substitute is silently selected. The current desktop target is macOS; unsupported process isolation fails explicitly.

## 2026-10-04：开工前调研与确认增量

工作分支 `feat/task-research-approval`，基于 `6fc3fc7fe`；收尾包含电脑操作新提交 `297577af8`。实现范围和限制见 `docs/prds/conversations/agent-task-tree.md` 的中文增量章节。

验证：新增门禁/搜索/界面与原调度交界 3 文件 14 项通过；缩进侧栏 1 项通过；真实 Pi 进程经本地模型测试服务验证调研无工具、重启仍待批准、批准后真实 write/edit/read 正常，1 项通过。最终类型检查通过；相关文件 lint 无错误（有现存风格警告）。GitHub 实时查询返回真实案例和匹配的 SKILL.md 路径。日志在 `/Users/owenzhao/TheOne/verification/task-research-*`。

未完成真实模型对前后端推荐质量的人工验收；本地模型测试回复不是生产回复。未打包、未安装、未重启当前应用、未推送 GitHub。本次 UI 只做中文。
