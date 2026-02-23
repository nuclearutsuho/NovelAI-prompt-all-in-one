# NovelAI-prompt-all-in-one 4.0

> **An all-in-one prompt management, wildcard, and Danbooru autocomplete toolkit tailored for NovelAI Diffusion.**
> **专为 NovelAI 打造的全能提示词管理、通配符支持与 Danbooru 自动补全工具包。**


## ✨ Features (核心特性)

| Feature Description |
| **🎨 Advanced Prompt Editor** | Intuitive visual tag editor (like A1111 WebUI). Drag-and-drop to reorder, click to edit weights, and double-click to toggle tags. Supports multi-character parallel editing. 直观的可视化 Tag 编辑器。支持拖拽排序、点击改权重、双击禁用/启用，还支持多角色并行的 Tag 编辑面板。 |
| **🎲 Wildcard & Dynamic Drawing** | Upload your `.txt` files to create wildcards. Use `__name__` anywhere. Supports sequential (Seq) or dynamic random (Rnd) token extraction natively! 上传您的文本文件作为通配符词库，随时在任何地方使用 `__分类__` 占位符。原生支持顺序抽取、随机抽取和限定数量的动态混合抽取！ |
| **📐 Multi-Resolution Override** | Easily define, save, and select multiple preset resolutions. Randomly or sequentially switch resolutions between generation batches without distorting the webpage image preview. 灵活定义并保存多选分辨率预设。在批量生成中，插件会为您自动顺序或随机切换分辨率，并且已修复与 NovelAI 网页版预览图缩放比例的冲突。 |
| **⚡ Fast Danbooru Autocomplete** | Instead of NAI's default slow suggestions, enjoy lightning-fast A1111 WebUI-style Danbooru tag autocomplete powered by an optimized WebWorker. Trigger it with "Space". 替代原版缓慢的补全逻辑，享受毫秒级响应的 WebUI 风格 Danbooru 词库自动补全（WebWorker 多线程加速）。完美支持中文拼音/汉字搜索。 |
| **📁 Dictionary / Sync Center** | Manage your custom dictionary offline! Perform CRUD operations on millions of tags, check alias and translate on the fly without heavy memory footprints. 内置强大的“资源与字典管理中心”页面，支持脱机增删改查上百万条 Danbooru 词典数据，支持快捷快照备份与批量导入/导出。 |
| **🛡️ Privacy & Zero Server** | All parsing and replacements are done before the prompt reaches NovelAI. **Zero external calls**, 100% Client-side. 所有的参数重写和解析都在请求发给 NovelAI 服务器前发生。**无任何外部 API 调用**，100% 纯客户端实现，确保您的隐私。 |

---

## 🖼️ Screenshots (截图展示)
![Editor Interface](https://github.com/user-attachments/assets/f5b5217a-b108-4023-b0ad-f8408656b4aa)  
![Dictionary Sync Center](https://github.com/user-attachments/assets/7bae13dd-03f1-4fb9-86a9-c2bb9af79a93)  
*(Note: Interface in latest version may vary with responsive designs and localizations.)*
*(注：最新版本的界面由于增加了多选分辨率及响应式排布，可能与上图略有不同。)*

---

## 🚀 How to Install (安装指南)

**1. Prepare the Files (准备文件)**  

[下载 ZIP 压缩包](https://github.com/david419kr/wildcards-for-novelai-diffusion/archive/refs/heads/full_autocomplete_experimental.zip) 并解压。
你将会得到一个名为 `wildcards-for-novelai-diffusion-main` 的文件夹。
*提示*: 请确保进入该文件夹后能平级看到 `manifest.json` 文件（不要包裹在双层文件夹中）。

**2. Load to Chrome / Edge (加载至浏览器)**  

- 在地址栏输入 `chrome://extensions`（Edge 浏览器输入 `edge://extensions`）回车。
- 打开右上角的 **开发者模式**。
- 点击 **加载已解压的扩展程序**，选择刚刚解压得到的文件夹。
- 完成后列表中会出现 “NovelAI-prompt-all-in-one” 并处于开启状态。

**3. Initial Setup (首次启动)**  
安装完毕！打开 `novelai.net/image`，你会在页面上看到注入的控制台面板。
*注意: 如果你早就打开了 NovelAI 页面，请先刷新一下页面再开始使用此插件。*
