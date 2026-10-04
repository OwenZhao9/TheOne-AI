# TheOne 万能助手｜网页版路演稿

这是独立的中文网页版演示稿，采用固定 1920×1080 舞台，浏览器会按比例缩放为 16:9。

## 本地打开

在项目根目录执行：

```bash
python3 -m http.server 3210
```

然后打开 [http://127.0.0.1:3210/presentation/](http://127.0.0.1:3210/presentation/)。

也可以直接双击 `presentation/index.html`；推荐使用本地 HTTP 方式，以便字体和相对资源加载更稳定。

## 演示操作

- `←` / `→`、`↑` / `↓`、空格、Page Up / Page Down：翻页
- `Home` / `End`：跳到开头或结尾
- 触控设备左右滑动：翻页
- 鼠标滚轮：翻页
- 鼠标移到左上角或按 `E`：进入本地编辑模式
- 编辑后按 `Ctrl/Cmd + S`：把文字保存到当前浏览器的本地存储

演示稿本身不依赖构建工具；页面 CSS 和 JavaScript 都内联。字体使用 Google Fonts 外链，断网时会回退到系统字体；产品截图、Logo 和说明文档均随目录保存。

## 文件

- `index.html`：正式入口
- `assets/`：正式稿引用的 TheOne Logo 与 AionUI 真实界面截图
- `speaker-notes.md`：12 页中文逐页讲稿，约 5 分钟
- `SOURCES.md`：来源、许可证与事实边界
- `HANDOFF.md`：官网 `/presentation/` 子路径接入说明
