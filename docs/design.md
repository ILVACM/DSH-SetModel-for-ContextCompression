# DSH-SetModel-for-ContextCompression · 具体设计（design）

> 版本：v5（2026-11-25）· 状态：**待人工审核**
> 依据：`docs/plan.md` v7（唯一需求基线）。本文只描述本轮"状态同步"修复的具体实现，不含可直接执行的全部代码（那属于 `code.md`）。
> v4→v5：**核心状态机重构**。删除 `pending` 状态；状态由"磁盘期望值 vs 现场运行值"在**读取时**实时判定；补齐运行时探测的多路径回退与自诊断；接入 DSH 官方的"重载已结算"事件作为失效信号；保存流程改为有界收敛窗口。
> 基线约束：压缩执行链路（`compactNow` 直调、错误分类、脱敏）、配置写入链路（行级精准编辑、原子写、备份、回读、回滚）、既有 UI 结构与参数控件**一律不改**。

---

## 1. 已确认的源码依据（本轮新增核实）

| 事实 | 出处 | 对设计的约束 |
|---|---|---|
| 压缩引擎本身就是 `compaction` 服务：`CompactionEngine extends Service`，构造函数 `super(ctx, 'compaction')` | `packages/compaction/compaction/src/index.ts:119-122` | `ctx.get('compaction')` 取到的**就是引擎实例**，不是"装着引擎的容器" |
| 引擎构造时把配置存到实例字段：`super(ctx)` → `this.config = resolveConfig(config)` | `packages/compaction/compaction-basic/src/index.ts:146-147` | 实例上的 `.config` 是可读的已解析配置，可作为**最强证据** |
| `resolveConfig` 的返回保留原字段名（`summarizationProvider/Model`、`compactionRetries`、`maxOverflowRetries`、`auto`），未设置的路由写成 `''` | `packages/compaction/compaction-basic/src/config.ts:98-109` | 现有 `canonicalFromConfig` 可直接吃该对象；`''` 已被 `routeValue()` 规范成 `null`，无需改规范化逻辑 |
| `app-boot/config-reload` 的官方语义是"profile patch 已重组进运行中的 Loader 树：**每个条目的更新都已结算**，且未引入新的 inactive 条目；不带 diff，监听者自行重读 Loader 条目" | `packages/boot/app-boot/src/index.ts:52-58` | 这就是缺失的"重载已结算"信号，可直接作为状态失效与结算依据 |
| 该事件在 `await ctx.loader.await()` 与所有旧 fiber `await` 之后才发出 | `packages/boot/app-boot/src/index.ts:412-424` | 收到它时读 Loader 条目，读到的是结算后的 generation |
| `hmr/reload` 在模块替换与 `loader.await()` 之后发出，携带 `Map<Plugin, Reload>` | `packages/boot/hmr/src/index.ts:749-753` | 可作"模块级换血完成"的次级加速信号；**不作为正确性依赖** |
| `reconcileProfile` 必须在 `runExclusive` 内调用，否则直接抛错；返回 `{warnings, pending, restartReason}` | `packages/boot/hmr/src/index.ts:937-938, 1016-1026` | 沿用 0.2.0 既有用法，不新增第二套重载 |
| `Entry` 同时持有 `ctx`（条目作用域）与 `fiber`（`this.ctx.registry.plugin(...)` 产物），配置在 `options.config` | `vendor/loader/src/config/entry.ts:43, 59, 274` | 探测链可经 `entry.fiber.ctx.get('compaction')` 到达实例所在作用域 |

## 2. 根因分析（为什么 0.2.0 必然长期卡在"等待热重载"）

三个环节同时犯了同一个错，任何一环都足以造成假象：

**① 服务端判定规则过严**
`runtime-status.ts:254-259` 只有 `runtime.source === 'service'` 且视图一致才判 `applied`，否则一律 `pending`。
但实测 `GET /config` 返回的是 `"runtimeSource": "loader"` —— 说明 `ctx.get('compaction')` 在插件自身上下文里**取不到引擎实例**（引擎在 Loader 条目自己的 fiber 作用域），探测退到了配置行。规则要求 service，环境只给 loader ⇒ **永远 `pending`**。

**② 记录只回放、不重探**
`applyConfiguration()` 把那次中间结论写进模块级 `lastApplication`（`web-routes.ts:209-210`），`configPayload()` 直接把它塞进响应（`web-routes.ts:184`）。之后无论 DSH 完成重载、重启进程、patch 被外部修改，这条记录都不会再被更新。

**③ 客户端也复述旧记录**
`CompactionCard.tsx:177-182` 打开面板时读 `lastApplication.status` 直接还原 phase；轮询判据同样是 `runtimeSource === 'service'`（`:145`, `:267`）。三层一致地错了。

**④ 事件订阅只数数**
`registerReloadListener()` 收到 `app-boot/config-reload` 时只做 `reloadRevision += 1`（`runtime-status.ts:190-193`），**不失效缓存、不重探、不更新记录**。所以它明明"知道"发生了重载，却不改变任何对外结论。

**结论**：`pending` 不该是一个对外状态。它把"尚未获得可靠结论"和"后台正在忙"混为一谈，且在缺乏重探机制时必然固化为永久假象。**设计上直接删除该状态。**

## 3. 文件级改动范围

| 文件 | 改动 | 不改的部分 |
|---|---|---|
| `plugin/src/runtime-status.ts` | 探测改为多路径链并记录尝试轨迹；增加探测缓存与失效；新增 `evaluateStatus()` 统一判定；事件回调触发失效；保存流程改为有界收敛；删除 `pending` 状态 | 异常脱敏、`PublicError/PublicCause`、`hmrCapability`、`applyConfiguration` 的 HMR 调用方式 |
| `plugin/src/web-routes.ts` | 响应新增顶层 `status` 块与 `lastCompaction`；`GET` 支持 `?probe=fresh`；POST 保存后走收敛判定；compact 成功后写入 `lastCompaction` | 写盘阶段、备份轮转、回读校验、回滚、400/409/500 语义、路由注册方式 |
| `plugin/src/index.ts` | 导出新增纯函数供 harness 使用；apply 时初始化 boot 基线 | 插件 id、apply 基本结构 |
| `plugin/src/client/CompactionCard.tsx` | phase 改为四态；状态一律取顶层 `status.state`；显示依据/确认时间/重载次数；`重新检查` 常驻；有界轮询替代"等 service" | 表单结构、选择器置灰、参数控件、保存/压缩请求体 |
| `plugin/src/client/locales.ts` | 四态新文案、依据标签、原因文案、`lastCompaction`；删除 `status.pending` | zh/en 键必须一一对应 |
| `plugin/README.md`、`plugin/locale/{zh,en}.json` | 说明状态语义与依据来源、`重新检查` | 安装方式与已验证说明 |
| `docs/impl-harness/h2-routes.mjs` | 新响应结构、`?probe=fresh`、缓存失效、收敛窗口、`lastCompaction` | 原有写盘/备份/冲突用例 |
| `docs/impl-harness/h3-client-ui.mjs` | 四态文案、依据行、`重新检查` 常驻、无 `pending` 残留 | 插槽与 DOM 安全断言 |
| `docs/impl-harness/h4-runtime.mjs` | 判定真值表、多路径探测、缓存、事件失效、矛盾防护 | 既有 HMR 能力检查与脱敏用例 |
| `plugin/package.json` | 版本 `0.2.1` | 依赖、`dsh` 清单、files |
| `docs/code.md` | 后续按本设计生成确定性施工图 | 本设计批准前不改插件代码 |

**明确不改**：`patch-editor.ts`、`settings-store.ts`、`compaction-service.ts`、`config-schema.ts`、`client/index.tsx`、`client/ModelPicker.tsx`、`client/NumberField.tsx`。

> 说明：`config-schema.ts` 不需改，因为 §1 已核实引擎实例的 `resolveConfig()` 输出保留原字段名且空路由为 `''`，现有 `canonicalFromConfig` 完全适用。

## 4. 核心数据结构

### 4.1 探测结果（扩展）

```ts
export type RuntimeSource = 'service' | 'loader' | 'unavailable'

export interface ProbeAttempt {
  path: string      // 'ctx.compaction' | 'root.compaction' | 'entry-fiber.compaction' | 'entry.options.config' | 'loader.entries'
  result: 'hit' | 'miss' | 'error' | 'skipped'
  note?: string     // 脱敏、无人身敏感信息
}

export interface RuntimeProbe {
  view: CompactionView | null
  unknown: TargetField[]
  source: RuntimeSource
  attempts: ProbeAttempt[]   // 新增：自诊断轨迹
  cached: boolean            // 新增：是否命中缓存
  probedAt: number           // 新增：本次探测时刻（epoch ms）
}
```

`attempts` 只用于展示与排查，包含路径名与命中/未命中，不含任何配置值或凭据。

### 4.2 保存证据（原 `ApplicationResult`，语义降级为"证据"）

```ts
export interface ApplyEvidence {
  desired: CompactionView       // 新增：这条证据对应的期望值，用于判断是否仍然相关
  warnings: string[]
  pending: Array<{ url: string; reason: string }>
  restartReason: string | null
  error: PublicError | null
  at: number                    // 新增：证据产生时刻
}
```

`lastApplication` 字段名保留（减少无谓变动），但**语义明确降级**：它是"上一次保存流程当场看到的证据"，**不是界面依据**；界面与判定一律用 §4.3 的实时结论。

### 4.3 状态报告（新增，唯一对外口径）

```ts
export type StatusState = 'applied' | 'restart-required' | 'unknown' | 'failed'
// 注意：没有 'pending'。类型层面就不可能再出现"热重载中"。

export type StatusBasis = 'service' | 'loader' | 'none'

export type StatusReason =
  | 'probe-unavailable'
  | 'loader-not-settled'
  | 'mismatch-no-evidence'
  | 'missing-restart-basis'
  | 'convergence-timeout'

export interface StatusReport {
  state: StatusState
  basis: StatusBasis
  reason: StatusReason | null
  detail: string | null            // 人话说明，脱敏
  confirmedAt: number              // 本次判定时刻
  reloadRevision: number
  lastSettledAt: number | null     // 最近一次"重载已结算"时刻
  probe: RuntimeProbe
  warnings: string[]
  error: PublicError | null
}
```

### 4.4 本插件最近一次压缩（O5）

```ts
export interface LastCompaction {
  at: number
  ok: boolean
  kind: string
  text: string        // 已脱敏、限长
}
```

仅记录**本插件按钮**触发的请求；进程重启后清空；界面必须标注"仅本插件按钮"。

## 5. 运行时探测：多路径链

### 5.1 探测顺序

对同一个请求依次尝试，首个命中即停（`hit` 后不再往下）：

| 序 | 路径 | 取法 | 证据等级 |
|---|---|---|---|
| 1 | `ctx.compaction` | `ctx.get('compaction')` → 实例 `.config` 为对象则用 | **强（service）** |
| 2 | `root.compaction` | `ctx.root?.get?.('compaction')` → 同上 | **强（service）** |
| 3 | `entry-fiber.compaction` | 遍历 `ctx.loader.entries()` 找 `options.id === 'compaction-basic'`，再 `entry.fiber?.ctx?.get?.('compaction')` → 同上 | **强（service）** |
| 4 | `entry.options.config` | 同一 entry 的 `options.config` | 弱（loader） |
| 5 | 兜底 | 全部失败 ⇒ `source: 'unavailable'` | 无 |

每一档都要 `try/catch`，异常记为 `error` 并继续下一档；不得因单档异常中断整条链。每档都写一条 `ProbeAttempt`。

> §1 已确认 `CompactionEngine` 以 `'compaction'` 注册自身、实例上有 `config`，因此第 1–3 档任一条通常都能命中；第 3 档是为"插件上下文看不见该服务"的真实情况准备的（0.2.0 就栽在这里）。

### 5.2 缓存

- 模块级缓存 `{ probe, at }`，TTL `PROBE_TTL_MS = 1000`。
- 命中缓存时返回 `cached: true`，并把 `probedAt` 置为**原始探测时刻**（不伪装成新探测）。
- 强制穿透：`probeRuntime(ctx, { fresh: true })`。
- 主动失效：收到 `app-boot/config-reload` / `hmr/reload`、POST 保存刚完成、compact 前后各一次。

### 5.3 缓存与正确性的取舍

缓存只影响"多久看到最新值"，不影响判定规则：TTL 上限 1 秒，且任何已知的变更事件都会立刻失效。因此不存在"因缓存导致长期错状态"的路径。

## 6. 状态判定：唯一入口 `evaluateStatus()`

### 6.1 输入

```
desired : CanonicalView      // 由 patch 文件当前内容经 canonicalFromConfig 得到
probe   : RuntimeProbe       // §5
evidence: ApplyEvidence|null // 最近一次保存证据
settledAt: number|null       // 最近一次 config-reload 结算时刻
bootBaseline: boolean        // 本进程已至少完成一次 apply() 且成功读到过 Loader 条目
```

派生量：

- `eq = probe.source !== 'unavailable' && sameCanonical(probe, desired)`
- `relevant = evidence !== null && sameCanonical({view: evidence.desired, unknown: []}, desired)`
- `restartEv = relevant && (evidence.restartReason !== null && evidence.restartReason !== '' || evidence.pending.length > 0)`
- `errEv = relevant && evidence.error !== null`
- `settled = settledAt !== null || bootBaseline`

### 6.2 真值表（权威口径）

| # | source | eq | restartEv | errEv | settled | → state | basis | reason |
|---|---|---|---|---|---|---|---|---|
| 1 | service | ✓ | 任意 | 任意 | 任意 | `applied` | service | null |
| 2 | loader | ✓ | ✗ | ✗ | ✓ | `applied` | loader | null |
| 3 | loader | ✓ | ✗ | ✗ | ✗ | `unknown` | loader | `loader-not-settled` |
| 4 | loader | ✓ | ✓ | 任意 | 任意 | `restart-required` | loader | 取 `restartReason ?? pending[0].reason` |
| 5 | service/loader | ✗ | ✓ | 任意 | 任意 | `restart-required` | source | 同上 |
| 6 | service/loader | ✗ | ✗ | ✓ | 任意 | `failed` | source | evidence.error |
| 7 | service/loader | ✗ | ✗ | ✗ | 任意 | `unknown` | source | `mismatch-no-evidence` |
| 8 | unavailable | — | ✗ | ✗ | 任意 | `unknown` | none | `probe-unavailable` |
| 9 | unavailable | — | ✓ | 任意 | 任意 | `restart-required` | none | 重启依据不依赖探测，仍可信 |
| 10 | unavailable | — | ✗ | ✓ | 任意 | `failed` | none | evidence.error |
| 11 | 任意 | — | `restartReason === ''` 且 `pending` 为空 | — | — | 按"无重启证据"处理 ⇒ 落 6/7/8 | — | `missing-restart-basis` |

**第 1 行是修复的核心**：只要运行实例自己报的配置等于期望值，就判"已生效"，**不管历史证据怎么说**。历史证据可能来自另一个模块的 pending，与本插件字段无关，不该污染结论（此类情形把证据记入 `warnings` 提示，但不改 state）。

**第 2 行是环境兜底**：承认"只能读到结算后的配置行"在真实环境里是常见情形；此时配合"已结算 + 无重启证据"判已生效，但 `basis` 必须老实写 `loader`，界面显示"依据：配置行（已结算）"，不得冒充运行时实例。

**第 3 行防止抢跑**：配置行一致但从未观察到任何结算，且不是进程启动基线 ⇒ 不判已生效。

**第 11 行是矛盾防护**：官方说需重启却给不出原因 ⇒ 不显示"需重启"（否则又是一个李鬼），降级为 `unknown` 并注明原因缺失。

### 6.3 硬性不变量

1. `StatusState` 类型无 `pending`；运行时也不得出现该字符串值。
2. 判定只依赖 §6.1 的输入，**不读** `lastApplication.status`（该字段已不存在于证据结构）。
3. `applied` 必须有 `probe.view !== null` 且 `eq === true`。
4. 任何无法给出可靠结论的分支一律落到 `unknown` 并带 `reason`，不允许沉默或猜测。

## 7. 事件、缓存与刷新时序

### 7.1 主信号：`app-boot/config-reload`

在 `apply()` 中注册（沿用"直接在 apply 内 `ctx.on(..., { global: true })`，不要包进 `ctx.effect`"的既有实证写法）：

```
onConfigReload():
  reloadRevision += 1
  lastSettledAt = Date.now()
  invalidateProbeCache()
  void refreshProbeInBackground()     // fire-and-forget 预热，异常吞掉
```

回调内**不得**再次调用 HMR（避免递归）。

### 7.2 次信号：`hmr/reload`（尽力而为）

同样以 `{ global: true }` 尝试注册：

```
onHmrReload():
  lastModuleReloadAt = Date.now()
  invalidateProbeCache()
```

注册失败或永不触发都**不影响正确性**（§7.1 + §7.3 已覆盖）。不得把它写进任何验收前提。

### 7.3 三个读取时机

| 时机 | 行为 |
|---|---|
| 打开面板 / 挂载组件 | `GET /config?probe=fresh`，强制穿透缓存 |
| 点「重新检查」 | 同上，并刷新 `confirmedAt` 显示 |
| 定时兜底 | 组件内 30s 一次 `GET /config`（用缓存即可） |

### 7.4 收敛后的轮询策略（客户端）

- 保存返回若为 `unknown` 且距保存 < 30s ⇒ 每 2s 轮询一次，最多 30s；
- 一旦拿到 `applied` / `restart-required` / `failed` ⇒ 立即停止轮询；
- 30s 后仍 `unknown` ⇒ 停止，显示"无法确认（可点重新检查）"，**不再显示任何"进行中"措辞**。

## 8. 保存流程：有界收敛

阶段 A（写盘）完全沿用 0.2.0，不改。

阶段 B（应用 + 判定）：

```
writtenAt = Date.now()
evidence  = await applyConfiguration(ctx, desired)   // 既有：runExclusive(reconcileProfile)
persistEvidence({ ...evidence, desired, at: writtenAt })
invalidateProbeCache()

deadline = writtenAt + CONVERGENCE_WINDOW_MS (2000)
for delay of [0, 250, 750]:
    if Date.now() + delay > deadline: break
    await sleep(delay)
    probe = probeRuntime(ctx, { fresh: true })
    if probe.source === 'service' && sameCanonical(probe, canonicalFromView(desired)) : break
    if evidence.restartReason !== null or evidence.pending.length > 0 : break

status = evaluateStatus(...)
return { saved: true, status, ... }
```

- 窗口上限 2 秒，绝不"继续等待"；窗口结束仍是 `unknown` 就如实返回 `unknown` + `convergence-timeout`。
- 收敛过程不阻塞于写盘结果：`saved: true` 与 `status.state` 是两个独立事实。
- 写盘失败（400/409/500）路径完全不变。

## 9. HTTP API

### 9.1 `GET /plugins/compaction-setmodel/config`

新增 query：`probe=fresh` 强制穿透探测缓存。

```json
{
  "degraded": false,
  "mode": "explicit",
  "fields": { "summarizationProvider": "nvidia", "retainRatio": 0.16 },
  "desired": { "mode": "explicit", "fields": {} },
  "runtime": { "mode": "explicit", "fields": {} },
  "runtimeSource": "loader",
  "status": {
    "state": "applied",
    "basis": "loader",
    "reason": null,
    "detail": null,
    "confirmedAt": 1795631200000,
    "reloadRevision": 12,
    "lastSettledAt": 1795631100000,
    "probe": {
      "source": "loader",
      "cached": false,
      "probedAt": 1795631200000,
      "attempts": [
        { "path": "ctx.compaction", "result": "miss" },
        { "path": "root.compaction", "result": "miss" },
        { "path": "entry-fiber.compaction", "result": "miss" },
        { "path": "entry.options.config", "result": "hit" }
      ]
    },
    "warnings": [],
    "error": null
  },
  "lastApplication": null,
  "lastCompaction": null,
  "backupKeep": 3,
  "entryFound": true
}
```

- `fields` / `mode` 仍是 patch 解析值，供表单初始化（不变）。
- `desired` / `runtime` 为双方规范化视图，便于自查（新增）。
- `status` 为唯一界面依据（新增）。
- `lastApplication` 保留但**不再是界面依据**，仅排查用。
- `runtimeSource` 保留（等价于 `status.probe.source`），避免破坏既有调用方。

### 9.2 `POST /plugins/compaction-setmodel/config`

请求体不变。响应在 0.2.0 基础上把 `application` 替换为 `status`（同时保留 `application` 作为证据快照，字段结构见 §4.2）：

```json
{
  "saved": true,
  "changes": [],
  "backupPath": "...",
  "keptBackups": 3,
  "status": { "state": "applied", "basis": "service", "reason": null, "...": "..." },
  "application": { "desired": {}, "warnings": [], "pending": [], "restartReason": null, "error": null, "at": 1795631200000 }
}
```

### 9.3 `POST /plugins/compaction-setmodel/compact`

请求/响应结构不变；成功后额外写入 `lastCompaction`（进程内），供卡片显示"本插件最近一次压缩"。

## 10. Client 状态机与展示

### 10.1 phase

```text
idle → saving → applied | restart-required | unknown | failed
```

- 删除 `pending`（含 `button.recheck` 只在 pending 出现的条件渲染逻辑）。
- 组件挂载即 `GET ?probe=fresh`，按 `status.state` 还原 phase。
- 保存后按响应 `status.state` 落 phase；`unknown` 时启动 §7.4 的有界轮询。
- 保留既有 `saveGeneration` 守卫：旧响应不得覆盖新一次保存的结果。

### 10.2 状态区渲染

```
[状态徽标] 已生效
依据：配置行（已结算） · 上次确认 13:04:31 · 配置重组 12 次    [重新检查]
```

- `basis` 文案映射：`service → 运行时实例`，`loader → 配置行（已结算）`，`none → 无可用证据`。
- `unknown` 时紧跟一行 `detail`（来自 `reason` 映射的人话）。
- `failed` 时沿用既有可展开 `<details>` 错误链。
- 「重新检查」**常驻可见**（不再只在某一状态出现）。

### 10.3 locales 变更

删除：`status.pending`。
修改：`status.applied` → `已生效`；`status.restart` → `需重启 DSH 才能生效`；`status.unknown` → `无法确认`；`status.failed` → `应用失败`。
新增：

| 键 | zh |
|---|---|
| `status.basis.service` | 运行时实例 |
| `status.basis.loader` | 配置行（已结算） |
| `status.basis.none` | 无可用证据 |
| `status.footer` | 依据：{basis} · 上次确认 {time} · 配置重组 {count} 次 |
| `reason.probeUnavailable` | 读不到运行实例与配置行，无法判断是否已生效 |
| `reason.loaderNotSettled` | 只读到配置行，且尚未观察到重载结算 |
| `reason.mismatch` | 配置与运行值不一致，且没有需要重启的依据 |
| `reason.missingRestartBasis` | 官方报告需重启，但未给出原因 |
| `reason.convergenceTimeout` | 等待生效超时，当前无法确认 |
| `compact.lastTitle` | 本插件最近一次压缩 |
| `compact.lastNone` | 尚未通过本插件触发过压缩 |
| `compact.lastScope` | 仅记录本插件按钮触发的压缩，不含其他会话或外部 /compact |

`en` 同步一一对应。

## 11. 测试设计

### 11.1 新增/改写用例

**h4（运行时，核心）**

1. 真值表逐行：11 行每行至少一例，断言 `state` / `basis` / `reason`。
2. 第 1 行专项：`evidence` 带 `restartReason` 但 service 探测一致 ⇒ 仍为 `applied`（历史证据不得污染）。
3. 多路径探测：仅 `root` 命中 / 仅 `entry-fiber` 命中 / 全 miss 转 loader / 全 miss 转 unavailable，各自 `attempts` 轨迹正确。
4. 缓存：TTL 内第二次调用 `cached: true` 且 `probedAt` 不变；`fresh` 穿透；事件后缓存失效。
5. 矛盾防护：`restartReason: ''` + `pending: []` ⇒ `unknown` + `missing-restart-basis`。
6. 不变量：判定结果中 `state` 永不等于 `'pending'`；`ApplicationStatus` 类型不含 `pending`（源码 grep 断言）。
7. 收敛窗口：mock 探测前两次旧值、第三次新值 ⇒ `applied`；始终旧值 ⇒ `unknown` 且总耗时 ≤ 2.5s。

**h2（路由）**

1. `GET /config` 含 `status` 块与 `desired`/`runtime`；`runtimeSource` 仍存在。
2. `GET ?probe=fresh` 穿透缓存（`cached:false`）。
3. `POST` 响应含 `status`，且 `application` 降级为证据结构（无 `status` 字段）。
4. 保存后缓存被失效（下一次 GET 的 `probedAt` 更新）。
5. compact 成功后 `lastCompaction` 出现且文本已脱敏、限长。
6. 既有：写盘/备份/回读/冲突/400/409/500 全部保持。

**h3（客户端）**

1. 四态文案存在；**不存在** `status.pending`；源码不含 `'pending'` phase 字面量。
2. `status.footer` 渲染依据/时间/次数；`重新检查` 常驻。
3. `reason.*` 文案键齐全且 zh/en 一一对应。
4. `compact.lastScope` 免责说明存在。
5. 既有：插槽、DOM 安全、选择器置灰断言保持。

### 11.2 关于既有 123 项检查

其中直接编码旧 `pending` 语义的断言（服务端 `applyConfiguration` 返回 `pending`、客户端 pending phase、`runtimeSource==='service'` 才能 applied 等）属于**口径变更**，必须按新真值表改写，**不是削弱**。改写清单在 `code.md` 中逐条列明，交付报告须给出"改写 N 项 / 新增 M 项 / 总数"的明确数字，不允许含糊带过。

### 11.3 实机验收（对应 plan §6）

| plan 编号 | 本设计的保证点 |
|---|---|
| D1 | §6.2 第 1/2 行 + §8 收敛 |
| D2 | §6.2 第 1 行优先于历史证据（第 1 行专项用例） |
| D3 | §6.3 不变量 1（无 pending）+ §7.4 停止轮询 |
| D4 | §6.2 第 2 行 + `bootBaseline` |
| D5 | §6.2 第 7 行（外部改动 ⇒ mismatch ⇒ unknown） |
| D6 | §6.2 第 8 行 |
| D7 | §6.2 第 11 行 |
| D8 | §4.3 单一 `StatusReport` 类型 + §6 单一入口 `evaluateStatus()` |
| R1 | §11.1/11.2 |
| R2 | 写盘链路零改动 |
| R3 | `compaction-service.ts` 零改动 |
| R4 | §5.2 缓存 + §7.4 有界轮询 |

## 12. 安全红线与降级

- 探测链每档 `try/catch`，单档失败不停机；`attempts` 不含配置值与凭据。
- 缓存只做加速，任何变更事件立刻失效；不允许"缓存导致长期错状态"。
- `applied` 必须有明确证据（service 或 已结算 loader）且视图一致；否则 `unknown`。
- 不拦截 `llm/stream`、不 monkey patch、不写 DSH 设置系统、不自行重启、不强制刷新。
- 事件回调内不得再次触发 HMR；`runExclusive` 不得嵌套。
- 写前备份、写后回读、diff 仅限 `compaction-basic` 目标字段——全部沿用。
- 轮询均有超时与取消；旧响应不得覆盖新状态。
- git 由人工接管；本设计批准前不改插件代码。

## 13. 已知限制（如实记录）

1. **`service` 证据可能始终拿不到**。若三档均未命中（作用域隔离等原因），将落到 `loader`。此时"已生效"的依据是"结算后的配置行 + 无重启证据"，界面会明确写"依据：配置行（已结算）"，**不会**冒充运行时实例。这是诚实降级，不是缺陷掩盖。
2. **配置行一致 ≠ 压缩行为已验证**。状态回答的是"配置已生效"，不是"下一次压缩已验证用了新路由"。行为验证仍靠 `compaction/summary` 事件，属验收动作，不属运行时依赖。
3. **多 isolate/多实例**：探测到的实例可能不是某会话实际使用的那个（沿用 v4 已知限制）。因此实机验收仍以行为证据为准。
4. **`hmr/reload` 可能收不到**（事件投递作用域不确定）。它是加速项，不承担正确性责任。
5. **只读本插件自己的压缩记录**。其他会话、外部 `/compact` 的压缩不在卡片显示范围，界面已注明。
6. **2 秒收敛窗口是有意的**。窗口结束后不再"继续等"，宁可显示"无法确认"也不显示假进行中。

## 14. 交付

- 版本 `0.2.1`；双端 typecheck 0 错误；build 成功；harness 全绿（含改写与新增）；生成 tgz 记 SHA256；`remove_bundle` + `install_bundle` 装入 web profile；保留 `0.2.0` 包作回滚素材。
- git 提交由人工接管。

## 15. 设计结论

问题不在压缩、不在写入、不在 HMR，而在**状态归口**：把"上次保存那一刻的照片"当成了"现在的事实"，又把"尚未有结论"命名成了"正在热重载"。

本设计做三件事，且只做这三件事：

1. **删掉 `pending`** —— 从类型层面消灭"中间态驻留"这种可能；
2. **改成现场比对** —— 每次读状态都重新比"期望 vs 实际"，运行值一致即已生效，历史证据只能解释失败或重启，不能否定已生效；
3. **补上"眼睛"** —— 探测走多路径（实例 → root → 条目 fiber → 配置行），接官方"重载已结算"事件做失效，打开面板即探、可手动重检、轮询只兜底。

代价是多一点探测开销（1 秒缓存 + 事件失效即可抹平），换来的是：状态不再骗人，也不需要人重启 DSH 后靠猜。
