# 官网接入交接

目标入口：`/presentation/`

## 交付目录

把本目录整体复制到官网静态资源根目录的 `presentation/`：

```text
presentation/
├── index.html
└── assets/
    ├── aionui-files.png
    ├── aionui-home.png
    ├── theone-icon-ice-blue-v1.png
    └── theone-icon-v1.png
```

`index.html` 内全部资源引用都是相对 `assets/` 的路径，不依赖 `/Users/owenzhao/...` 等本机绝对路径，也不需要 Node、npm 或构建步骤。

## 运行与验证

本地项目根目录：

```bash
python3 -m http.server 3210
```

访问 `http://127.0.0.1:3210/presentation/`，用 Chrome 检查：

1. 首屏能显示 Logo、中文标题与右侧圆环；
2. `←` / `→`、空格、触控左右滑动能翻页；
3. 每页保持 16:9，窗口缩放到 1280×720 与手机窄视口时不重排；
4. 图片资源不出现 404，截图边界不溢出；
5. `E` 可进入本地文字编辑模式，`Ctrl/Cmd+S` 可保存。

官网接入时不要只复制 `.frontend-slides/slide-previews/`；那是封面选择阶段的中间预览。正式入口只使用本目录 `index.html` 与 `assets/`。

## 网络依赖

产品图片和 Logo 已本地随目录提供。仅字体请求依赖 Google Fonts；如官网需要完全离线，可在不改变布局的前提下替换为已获授权的本地字体文件，并同步更新 `SOURCES.md`。

## 当前限制

这是一份独立路演文稿，不是 TheOne 应用界面重写。它不包含登录、在线工作台或设备控制入口；官网是否提供这些功能由官网任务另行负责。
