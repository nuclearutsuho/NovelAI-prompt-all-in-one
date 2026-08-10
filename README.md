<div align="center">

# 🎴 NovelAI Prompt All-in-One

### 为 NovelAI Image Generation 打造的一站式提示词工作台

可视化 Tag 编辑、通配符、Group Tags、历史收藏、Danbooru 自动补全、本地同步与批量生成，全部集中在 NovelAI 页面内完成。

<p>
  <img src="https://img.shields.io/badge/version-1.0.0-7c3aed?style=for-the-badge" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-supported-10b981?style=for-the-badge" alt="Chrome and Edge">
  <img src="https://img.shields.io/badge/data-local--first-f59e0b?style=for-the-badge" alt="Local first">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT License"></a>
</p>

<p>
  <a href="https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/archive/refs/heads/full_autocomplete_experimental.zip"><strong>下载最新源码</strong></a>
  ·
  <a href="#-安装">安装指南</a>
  ·
  <a href="#-核心功能">核心功能</a>
  ·
  <a href="CHANGELOG.md">更新日志</a>
  ·
  <a href="https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/issues">问题反馈</a>
</p>

</div>

> [!IMPORTANT]
> 当前 `1.0.0` 是完整重构后的新版本基线，不沿用早期原型的 `4.x` 版本顺序。项目目前通过 GitHub 提供源码，采用“加载已解压的扩展程序”的方式安装。

> [!NOTE]
> 本项目是社区维护的非官方浏览器扩展，与 NovelAI / Anlatan 没有隶属或合作关系。

## ✨ 它能做什么

NovelAI Prompt All-in-One 将原本分散在网页输入框、文本文件和外部工具中的提示词工作流，整合成一个直接嵌入 NovelAI 的可视化工作台。

你可以在不离开生图页面的情况下整理 Tag、切换角色提示词、调用通配符、恢复历史收藏、管理标签组，并将重要数据同步到自己的本地文件夹。

## 🚀 核心功能

| 功能 | 能力 |
| --- | --- |
| 🧩 **可视化 Tag 编辑器** | Tag 胶囊化编辑、拖拽排序、权重调整、禁用/启用、去重，以及正面、负面和多角色提示词管理。 |
| 🎲 **通配符与动态抽取** | 支持 `__通配符__`、随机抽取、顺序抽取、动态权重组、分步计数与批量生成工作流。 |
| 🗂️ **Group Tags** | 按分类和标签组整理常用 Tag 与句子，支持编辑、排序、收藏、预览、导入导出和快捷插入。 |
| 🕘 **历史与收藏** | 自动记录提示词快照，支持全文、局部与角色片段收藏，以及恢复或追加到指定提示词区域。 |
| ⚡ **Danbooru 自动补全** | 内置本地词典与快速搜索，支持英文 Tag、中文释义和别名检索，不依赖在线词典服务。 |
| 📂 **本地同步中心** | 将通配符、收藏、Group Tags 和用户词典同步到本地目录，支持冲突拦截、快照、导入导出和文件树管理。 |
| 🖼️ **批量生成辅助** | 提供自动连点、随机时间偏移、多分辨率预设、快捷键和生成状态协同。 |
| 🤖 **可选 AI 翻译** | 可配置 OpenAI 兼容接口，将自然语言翻译为英文提示词，或为英文 Tag 生成中文译注。 |

## 🖼️ 界面预览

<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/dfd32b51-5cfd-4bfc-b936-0a01a38c5de9" alt="可视化提示词编辑器">
      <br><sub>可视化提示词编辑器</sub>
    </td>
    <td width="50%" align="center">
      <img src="https://github.com/user-attachments/assets/bc6e9b4f-b14a-4817-817c-ea77c8999845" alt="通配符与设置面板">
      <br><sub>通配符与设置面板</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="https://github.com/user-attachments/assets/51eefe87-3d81-4d09-9f0a-072c0a77177d" alt="NovelAI 页面内的插件工作区">
      <br><sub>直接嵌入 NovelAI Image Generation 页面</sub>
    </td>
  </tr>
</table>

## 📦 安装

### 环境要求

- Google Chrome 或 Microsoft Edge 等 Chromium 浏览器。
- 能够正常访问并使用 [NovelAI Image Generation](https://novelai.net/image)。
- 无需安装 Node.js，无需构建，也无需运行安装脚本。

### 方法一：下载 ZIP

1. 点击顶部的 **下载最新源码**，或直接下载 [`full_autocomplete_experimental` 分支 ZIP](https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/archive/refs/heads/full_autocomplete_experimental.zip)。
2. 将 ZIP 解压到一个固定目录。
3. 打开 `chrome://extensions`；Edge 用户打开 `edge://extensions`。
4. 开启右上角的 **开发者模式**。
5. 点击 **加载已解压的扩展程序**。
6. 选择能够直接看到 `manifest.json` 的文件夹。
7. 打开或刷新 `https://novelai.net/image`。

### 方法二：使用 Git

```bash
git clone -b full_autocomplete_experimental https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one.git
```

克隆完成后，将仓库根目录作为“已解压的扩展程序”加载即可。

> [!WARNING]
> 更新前建议先导出重要收藏、Group Tags 和通配符。对于已解压扩展，尽量覆盖原目录并保持加载路径不变；换到全新的目录重新加载时，浏览器可能将它识别为另一个扩展，原本地数据会暂时不可见。

## ⚡ 快速开始

1. 安装扩展后刷新 NovelAI 生图页面。
2. 点击页面上的 🎴 悬浮按钮打开提示词工作台。
3. 在正面、负面或角色输入区添加 Tag，编辑结果会同步回 NovelAI。
4. 打开 **Group Tags** 整理常用组合，或从历史收藏中恢复提示词快照。
5. 在设置中按需开启自动补全、快捷键、AI 翻译等功能。
6. 需要长期备份时，进入 **同步中心** 并绑定一个本地文件夹。

### 默认快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Alt + M` | 展开或最小化主面板 |
| `Alt + Q` | 打开主面板并聚焦基础提示词 |
| `Ctrl + Enter` | 触发生成 |

快捷键可以在插件设置中修改。输入框获得焦点时，插件会尽量避免拦截正常文本输入。

## 🧠 主要工作流

### 编辑提示词

- 将逗号分隔的提示词转换为可视化 Tag。
- 拖拽调整顺序，快速修改权重或临时禁用某个 Tag。
- 分别管理基础正面、负面和多个角色的正负提示词。
- 在 NovelAI 内部状态不可用时自动降级为 ProseMirror DOM 同步。

### 复用提示词资产

- 使用 Group Tags 保存常用画风、角色、构图和句子组合。
- 使用收藏夹保存全文、局部提示词或角色片段。
- 通过通配符文件批量维护可随机或顺序抽取的候选内容。
- 使用导入导出在不同设备或目录之间迁移数据。

### 本地备份与同步

- 将浏览器中的通配符与配置资源同步到用户选择的目录。
- 监测外部文件变化，避免静默覆盖较新的本地修改。
- 对关键配置执行写前快照，并保留手动快照与差异查看能力。
- 文件删除、重命名和移动失败时阻止浏览器存储提前更新。

## 🔐 数据与隐私

本项目采用 **Local-first** 设计，但不同功能的数据流并不完全相同：

| 数据或功能 | 默认存储位置 | 是否产生额外网络请求 |
| --- | --- | --- |
| 设置、历史、收藏、Group Tags | 浏览器扩展本地存储 | 否 |
| 通配符与用户词典 | 浏览器本地存储；绑定后可写入用户选择的目录 | 否 |
| 内置 Danbooru 词典 | 随扩展本地提供 | 否 |
| NovelAI 生图 | NovelAI 官方页面与接口 | 是，由 NovelAI 页面本身发起 |
| AI 翻译 | API 地址和密钥保存在扩展本地存储 | 仅在用户主动配置并使用时，请求用户指定的服务商 |

> [!CAUTION]
> AI 翻译功能会把你提交的文本发送到所配置的 API 地址。请自行确认服务商的隐私政策，不要使用来源不明的代理地址，也不要在提示词中包含敏感信息。

### 权限说明

- `storage` / `unlimitedStorage`：保存设置、词典覆盖、历史收藏和标签组等本地数据。
- `novelai.net` / `image.novelai.net`：在 NovelAI 生图页面注入工作台并同步提示词与生成状态。
- 可选的 `http://*/*` / `https://*/*`：仅用于用户自定义 AI 接口。插件会在首次访问具体 API 域名时请求对应站点权限，而不是默认访问所有网站。
- 本地文件夹：由浏览器的目录选择器单独授权；插件不能在用户未选择目录的情况下读取任意本地文件。

## 🌐 兼容性

| 项目 | 当前状态 |
| --- | --- |
| NovelAI Image Generation | ✅ 当前官网兼容层已适配 |
| Google Chrome | ✅ 支持 Manifest V3 |
| Microsoft Edge | ✅ 支持 Chromium 扩展加载方式 |
| Firefox | ❌ 暂未适配 |
| Chrome 应用商店 | ⏳ 尚未发布，目前通过 GitHub 手动安装 |

NovelAI 官网的 DOM、内部状态和请求结构可能随时调整。如果页面更新后插件不再显示或无法同步，请先重新加载扩展并刷新页面，然后到 [Issues](https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/issues) 提交问题。

## 🛠️ 项目结构

```text
├─ bridge.js                         # 内容脚本桥接、面板注入与会话隔离
├─ injector.js                       # NovelAI 页面上下文功能入口
├─ lib/
│  ├─ injected/                      # 官网兼容层与提示词同步控制器
│  ├─ runtime/                       # 生命周期管理
│  └─ storage/                       # 扩展存储仓库与迁移
├─ modules/                          # 连点器、Group Tags、历史收藏
├─ pages/
│  ├─ popup.html / popup.js          # 主提示词工作台
│  ├─ group-tags.html                # Group Tags 面板
│  └─ sync.html / sync.js            # 本地同步与字典中心
└─ manifest.json                     # Chrome Manifest V3 清单
```

项目使用原生 JavaScript、HTML 和 CSS，不需要打包构建。核心复杂功能已拆分为独立控制器，便于后续维护 NovelAI 兼容逻辑。

## 🧪 当前质量状态

- ✅ 68 项本地回归测试通过。
- ✅ 42 个产品脚本语法检查通过。
- ✅ 完成 Chrome 中 NovelAI 页面的自动重载验收。
- ✅ 主面板、Group Tags 和自动生成模块无重复注入。
- ✅ 当前没有已知的 P0 / P1 阻断问题。

测试脚本只用于本地开发验收，不包含在 Git 提交和用户安装包中。

## ❓ 常见问题

<details>
<summary><strong>安装后页面上没有出现插件按钮怎么办？</strong></summary>

1. 确认扩展管理页中插件处于启用状态。
2. 确认加载的是直接包含 `manifest.json` 的目录。
3. 点击扩展卡片上的“重新加载”，然后刷新 NovelAI 页面。
4. 确认当前地址是 `https://novelai.net/image`。

</details>

<details>
<summary><strong>升级后原来的数据不见了怎么办？</strong></summary>

先检查浏览器中是否同时出现了两个同名扩展。加载路径变化可能生成不同的扩展身份；重新启用旧目录通常可以看到原数据。恢复后请先导出数据，再迁移到新目录。

</details>

<details>
<summary><strong>不配置 AI 接口能否使用？</strong></summary>

可以。AI 翻译是完全可选的功能，Tag 编辑、通配符、Group Tags、收藏、自动补全和本地同步都不依赖 AI 接口。

</details>

<details>
<summary><strong>为什么官网更新后插件可能突然失效？</strong></summary>

插件需要与 NovelAI 页面中的编辑器、状态和生成接口协同工作。官网修改内部结构时，兼容层可能需要同步更新。请提交包含浏览器版本、复现步骤和控制台错误的 Issue。

</details>

## 🗺️ 发布路线

- [x] 升级 NovelAI 官网兼容层。
- [x] 重构生命周期、存储、提示词同步和 Group Tags 架构。
- [x] 修复多标签页会话隔离与本地同步一致性问题。
- [x] 将新架构版本基线重置为 `1.0.0`。
- [ ] 完成 `v1.0.0` 发布包验收。
- [ ] 创建首个 GitHub Release 与版本 Tag。

详细变更请查看 [CHANGELOG.md](CHANGELOG.md)，版本规则请查看 [VERSIONING.md](VERSIONING.md)。

## 🤝 反馈与贡献

- 遇到错误：提交 [Bug Report](https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/issues/new)。
- 有功能建议：在 [Issues](https://github.com/nuclearutsuho/NovelAI-prompt-all-in-one/issues) 中描述使用场景和期望行为。
- 提交代码前，请尽量把官网兼容选择器集中在兼容层，并为复杂状态逻辑保留必要的中文注释。

如果这个项目改善了你的 NovelAI 工作流，欢迎点一个 ⭐，也欢迎分享你的使用体验。

## 📄 开源许可证

本项目采用 [MIT License](LICENSE)。你可以自由使用、复制、修改、合并、发布、分发、再许可和商业使用本项目，但需要在副本或主要代码中保留原始版权与许可证声明。

---

<div align="center">

**NovelAI Prompt All-in-One · Make prompting organized.**

Version `1.0.0` · Manifest V3 · Local-first

</div>
