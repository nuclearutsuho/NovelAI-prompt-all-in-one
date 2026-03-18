# Popup Guardrails

## 目的

`pages/popup.js` 仍然承担 popup 启动、状态拼装和多个 controller 的接线。  
它最常见的故障不是语法错误，而是启动阶段的运行时断点，表现为：

- popup 一直停在 `Connecting to NovelAI...`
- tag 不显示
- 按钮全部失效

因此，popup 相关改动必须先过启动级检查，再做浏览器手测。

## 必跑检查

只要修改了这些文件，就必须执行下面的检查：

- `pages/popup.js`
- `pages/popup/*.js`
- `lib/TagEditor.js`
- 任何被 `pages/popup.js` 直接导入的新模块

最低要求：

```powershell
node --check pages/popup.js
Get-ChildItem pages/popup/*.js | ForEach-Object { node --check $_.FullName }
node --check lib/TagEditor.js
node scripts/popup-smoke.mjs
```

说明：

- `node --check` 负责挡住语法级错误。
- `scripts/popup-smoke.mjs` 负责真实执行 `DOMContentLoaded -> initUI() -> initData() -> initCommunication()` 启动链，拦截未定义变量、依赖注入名写错、初始化阶段异常等“整页直接损坏”的问题。
- 这套检查主要要求 AI 在每次改 popup 相关代码后先跑；人工需要时也可以手动执行。

## 手测顺序

通过上述检查后，再做浏览器手测。最少覆盖：

1. popup 能正常打开，不再卡在 `Connecting to NovelAI...`
2. base prompt 与 character prompt 首次回读正常
3. AI 翻译按钮、角色编辑器、历史恢复、Group Tags 入口可点击
4. 刷新网页后不新增零 diff 历史
5. 网页侧编辑后，未改写本体的 AI tag 仍保留 `aiOriginal`

## Popup 边界

`popup.js` 只保留这些职责：

- popup 状态拼装
- UI 接线
- 历史入口

不要再把新的状态机直接堆回 `popup.js`。  
后续新功能默认优先进入 `pages/popup/*.js` controller。

## 后续结构治理顺序

固定顺序如下：

1. `history-controller`
2. `group-tags-controller`
3. `resolution-controller`

角色编辑器逻辑暂不优先拆。  
等历史和 Group Tags 两块收口后，再处理角色编辑器这一层深耦合逻辑。

## 说明

- 当前仓库没有现成测试框架，因此本轮采用零依赖 Node 脚本，而不是 Jest/Vitest。
- git hook 和 CI 不是当前必须项；如果后续需要，可以直接建立在 `scripts/popup-smoke.mjs` 之上。
