# 项目理解报告（供人工审核）

> 生成时间：2026-11-20 · 审核人：项目所有者 · 生成者：lead（DSH 会话）

## 1. 仓库现状

| 项目 | 内容 |
|---|---|
| 仓库 | `D:\DSH-SetModel-for-ContextCompression` |
| 远程 | `github.com/ILVACM/DSH-SetModel-for-ContextCompression` |
| 分支 | `main`，仅 1 个 Initial commit，工作区干净 |
| 文件 | 仅 `README.md`（2 行）与 `LICENSE`（Apache-2.0），**尚无任何代码** |

README 原文：

> 专门给DSH用于可视化设置上下文压缩专用模型。保证使用特殊渠道模型服务时，不容易出现异常崩溃。

## 2. 项目意图（通俗解读）

DSH（DeepSeek Harness）在长对话时会自动做**上下文压缩**：把较早的历史对话交给模型总结成一段摘要，替换原历史，以腾出上下文空间。

默认情况下，**压缩用的模型 = 当前聊天路由到的主模型**。当主模型走"特殊渠道"（第三方中转/代理 API）时，压缩辅助请求可能因接口兼容性问题失败，导致会话异常甚至崩溃。

本项目的目标：做一个**可视化设置入口**，让用户能单独指定"上下文压缩专用模型"（独立的 provider / model），与聊天主模型解耦，从而避开兼容性问题。

## 3. 关键背景发现（已核实）

对当前安装的 DSH（Desktop，profile=`web`）源码与文档的只读勘察结论：

1. **压缩功能由这两个包实现**：
   - `@deepseek-ai/dsh-compaction`：压缩契约/接口（服务定义、锁、事件）；
   - `@deepseek-ai/dsh-compaction-basic`：默认后端（自动压缩 + `/compact` 命令 + 溢出恢复）。
2. **DSH 原生已支持"压缩专用模型"配置**。`dsh-compaction-basic` 的配置项中包含：
   - `summarizationProvider`：压缩摘要使用的 provider（默认空 = 跟随最近路由的主模型）；
   - `summarizationModel`：压缩摘要使用的 model；
   - 另有 `thresholdRatio`、`retainRatio`、`headroomTokens`、`maxTokens`、`modelPolicies` 等调节项。
3. 因此，本插件的核心工作不是"发明"压缩模型选择能力，而是：
   - 在 **Web GUI 中提供可视化设置界面**；
   - 把用户选择**写入 profile 的 cordis 配置**（patch `dsh-compaction-basic` 的 config），使其生效并持久化。
4. 插件落地路径（依据 DSH 官方插件规范）：
   - 在工作区编写 bundle（`package.json` + `cordis.patch.yml` + Host/Client 文件）；
   - 用 `plugin_manager.install_bundle` 安装到 profile（`C:\Users\hbk\.dsh\profiles\web`）；
   - Client 侧通过 `ctx.slots.register` 向 Web GUI 注册设置界面。
5. **"特殊渠道"的实物证据**：当前 profile 已安装多个第三方渠道插件，例如
   `@hbk/dsh-opencode-local`、`dsh-connect-catpaw`、`dsh-connect-trae`、
   `dsh-connect-workbuddy`、`dsh-deveco2api-plugin`、`@dmh2002/dsh-connect-qoder` 等。
   这些 connect/2api 类插件正是把第三方服务接入 DSH 的"特殊渠道模型服务"，
   与 README 描述的痛点（压缩请求走这些渠道时易崩溃）完全吻合。

## 4. 已确认的方向（用户拍板）

- 形态：**DSH 插件**（bundle）；
- 界面：集成到 **DSH 的 Web GUI**（`http://127.0.0.1:3080`）。

## 6. 项目起因（源自 `D:\DSH-Opencode2API-hbk\docs\handoff.md`，2026-11-20 版）

前一个项目 **DSH-Opencode2API-hbk**（插件 `@hbk/dsh-opencode-local`，把本地 opencode CLI 桥接给 DSH 用）在迭代中正好处理过"压缩专用模型"问题，其结论直接催生了本项目：

**演进链**：
- **0.2.5**：设置页加「上下文压缩」tab（压缩模型选择器），并尝试在 `llm/stream` 事件上拦截 `purpose==='compaction'` 请求、改路由到用户选的模型；
- **0.2.6**：压缩偏好改存插件自有 `~/.dsh-opencode-local/compaction.json`（避免写 DSH 配置触发 profile 重组/重启）；
- **0.2.7 / 0.2.8**：修监听器接线（`global:true, prepend:true`、去掉 `ctx.effect` 包装）——监听器终于能触发；
- **0.2.8-2 决定性发现**：即使监听器触发，**跨工作区会话的压缩根本不经过插件 fiber 的监听器**（Cordis 多 isolate/多 root 树）——**插件侧事件拦截改路由这条路走不通**；于是改用 **compaction-basic 原生配置**：直接在 web profile 的 `cordis.patch.yml` 写入 `summarizationProvider: nvidia` + `summarizationModel: nvidia/nemotron-3-ultra-550b-a55b`，压缩从源头走 nvidia；
- **0.2.8-3（现行版，已验收）**：插件**彻底退出上下文压缩**——删除压缩模型选择器/按钮/监听器/偏好存储，「上下文压缩」tab 改名「上下文状态」只留监测显示。人工裁决：**"插件侧压缩改路由思路本身不可行，直接放弃——压缩由人工另行方案接管"**。

**本项目 = 那个"另行方案"的载体**。当前状态：压缩专用模型配置（compaction-basic 的 `summarizationProvider/summarizationModel`）已手工预置在 web profile 的 `cordis.patch.yml`（已核实存在），但**没有任何可视化界面**，改一次要手工编辑 74KB 的 YAML 并重启 DSH。本项目的使命就是把这件事做成 Web GUI 里的可视化设置。

**必须继承的教训（前项目用真实踩坑换来）**：
1. ❌ 不要做插件侧 `llm/stream` 事件拦截改压缩路由——跨 isolate 不触发，已证死路；
2. ❌ 不要试图运行时写 DSH 原生设置系统改 `summarizationProvider/Model`——0.2.5 探针证明构造期 deepFreeze、无 volatile、settings 寻址不到，不可写；
3. ✅ 正确落点 = **compaction-basic 原生配置**（profile `cordis.patch.yml` 中的条目），所有会话/作用域原生生效；
4. ⚠️ 改 profile patch 后 **DSH 不热重载，必须重启才生效**（`dsh plugin add` 同理）；
5. ⚠️ profile 安装/验收一律走 **web profile**（`C:\Users\hbk\.dsh\profiles\web`）；
6. ⚠️ 版本号不能用四段式 semver（`0.2.8.1` 会被 pnpm 拒绝），沿用 `0.2.8-x` 式连字符命名；
7. 工作约定：方案 → 人工审核/裁决 → 批准 → 执行；"先不要做任何操作"= 硬停；git 提交由人工接管。

## 7. 下一步计划（按新认知修订）

1. **方案设计（先给人工审核，批准后再动工）**：插件如何安全地读写 web profile 的 `cordis.patch.yml` 中 `compaction-basic` 条目（定位/编辑/原子写/备份/生效提示"需重启"）；
2. 确定界面挂载点：细读 `dsh-client-ui-settings*` 的插槽与 `dsh-compaction-basic` 配置装载方式；
3. 搭建插件骨架（manifest / patch / client 界面 / 中文 locale）；
4. 实现可视化设置：展示当前压缩专用模型（provider + model），支持从已配置渠道中选择或手填，保存后写回 patch 并提示重启生效；
5. 安装到 web profile，重启后用长对话 + `/compact` 验证压缩请求确实走所配专用模型；
6. 完善文档（README、安装说明）后发布到 GitHub 仓库。

## 8. 待确认问题

- 修改 `cordis.patch.yml` 的方式：插件进程内直接编辑文件（需谨慎原子写+备份），还是仅生成配置片段由人工粘贴？
- 设置界面放在 Web GUI 的哪个位置（设置页新增入口 / 对话输入区入口）？
- 是否需要同时暴露压缩触发参数（thresholdRatio / retainRatio / headroomTokens 等）的可视化调节，还是仅做"专用模型"选择？
