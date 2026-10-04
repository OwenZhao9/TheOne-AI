# 作图助手

这是 TheOne 内置的专门作图 Bot，也可以按标准 Bot 包单独导入。它使用 Pi 独立设置中的真实图像模型和内置图像工具，生成的文件保存到当前会话工作区。

使用前请在 Pi Settings 的“Pi 生图设置”中填写火山方舟 API 地址、模型和 API 密钥；默认地址为 `https://ark.cn-beijing.volces.com/api/v3`，默认模型为 `doubao-seedream-5-0-flash-260915`。这个设置独立于旧版 AionUI Tools 配置。没有可用配置时，Bot 会保留请求并明确提示配置要求，不会生成占位图片或只交付提示词。

它可以处理图片、Logo、插画、海报和已有图片编辑；最终会报告实际文件路径，父任务仍需按 TheOne 的任务树规则检查并验收文件。
