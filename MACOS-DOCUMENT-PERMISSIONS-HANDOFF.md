# macOS 文稿权限修复交接

## 结论

TheOne 原打包流程最后执行 `codesign --force --deep --sign -`，主包和 Electron 内部代码因此使用 ad hoc 签名。ad hoc 的 macOS 指定要求绑定当前代码版本；更新后系统不能把新版本可靠识别为同一应用，所以“想访问文稿文件夹中的文件”会再次出现。内置 Node 和 Cua Driver 本身已有稳定的 Developer ID 签名，不是这次根因。

## 已完成

- 新增 `scripts/aionpi/sign-macos.mjs`：优先使用 `AIONPI_CODESIGN_IDENTITY`/`CSC_NAME`，否则从钥匙串确定性选择 Developer ID Application，其次 Apple Development。
- 无稳定证书时打包明确失败；拒绝 `identity "-"`，不会静默退回 ad hoc。
- 签名后执行严格验证，并检查 `Signature=adhoc` 与缺失 `TeamIdentifier`。
- `aionpi:package` 已改用该脚本；构建说明已同步更新。
- 新增 4 项签名身份选择单元测试。

## 验证

- 4/4 针对性单元测试通过。
- 新脚本语法、格式检查和 Oxlint 通过。
- 用临时复制的完整 `TheOne.app` 完成真实 Apple Development 深度签名、严格验证和指定要求检查；未重签 `/Applications/TheOne.app`，未重启、覆盖或安装应用。
- 当前已安装 `/Applications/TheOne.app` 仍是原 ad hoc 版本；修复包尚未安装。

## 交付时注意

从现有 ad hoc 安装包切换到稳定证书的修复包时，macOS 可能要求用户对文稿访问重新确认一次；这是身份切换造成的单次授权，不能由程序绕过。之后使用同一稳定证书签名的更新应保持兼容。当前机器没有 Developer ID Application 证书，Apple Development 仅适合同一台 Mac 的本地持续更新；面向其他设备发布仍需 Developer ID Application、公证和本人完成的 Apple 认证。
