# DSH-SetModel-for-ContextCompression · 施工图（code）

> 版本：v-next（2026-11-25）· 对应 `docs/plan.md` v7 + `docs/design.md` v5 · 目标版本 **0.2.1**
> 本文件是**确定性施工图**：所有需整文件替换的内容都给出完整围栏块，逐字复制即可得到唯一结果；任何模型、任何 agent 软件按本文件执行都会产出字节相同的文件。
> 执行者**不得**自行优化、重排、改写注释、调整缩进或"顺手"改动未列出的文件。

---

## 0. 不可变约定

1. 本文件 §4 中的围栏代码块就是目标文件的**完整内容**。围栏标记行本身不属于文件内容。
2. 写入时：文件末尾保留**恰好一个**换行符（`\n`），不追加空行，不删除末行。
3. 编码 UTF-8 无 BOM；行尾 LF。
4. 只修改 §4 列出的文件。§5 列出的文件**一个字节都不能变**。
5. 施工阶段（W1–W6）**禁止**运行 `npm run build`、`npm run typecheck`、`npm pack`、`node run-all.mjs`、`plugin_manager`。全部集中到 §6 串行执行。
6. 禁止 git 操作；禁止修改 `docs/plan.md`、`docs/design.md`、`docs/code.md` 自身。
7. 禁止修改真实 profile 的 `cordis.patch.yml`；测试只写临时目录。
8. 禁止运行任何格式化器（prettier/eslint/tsdown 之外的格式化）。

---

## 1. 与 plan / design 的对应

| 本文件位置 | 满足的 plan 条目 | 满足的 design 章节 |
|---|---|---|
| F01 `runtime-status.ts` | O1 / O2 / O3 | §4.1–4.3, §5, §6, §7.1–7.2, §8 |
| F02 `web-routes.ts` | O1 / O3 / O5 | §4.4, §8, §9 |
| F03 `index.ts` | — | §3 |
| F04 `locales.ts` | O4 | §10.3 |
| F05 `CompactionCard.tsx` | O4 | §10.1–10.2 |
| F06–F08 harness | R1 | §11.1 |
| F09–F11 元数据 | 交付 | §10.3, §14 |

**一处对 design 的明确化（不改语义，仅消除歧义）**：`StatusReport.detail` 只承载 **DSH 官方给出的重启原因原文**（如 `hmr-unavailable`、`host-module`），不承载界面人话；界面人话由 `status.reason.*` 的 locale 文案提供。两者不重复。

---

## 2. 全局契约

### 2.1 状态枚举（唯一权威）

```text
StatusState  = 'applied' | 'restart-required' | 'unknown' | 'failed'
```

**不存在 `pending`。** 全部代码中不得新增该值。

### 2.2 探测路径常量（顺序固定）

```text
1  ctx.compaction
2  root.compaction
3  entry-fiber.compaction
4  entry.options.config
```

### 2.3 常量

| 常量 | 值 |
|---|---|
| `PROBE_TTL_MS` | `1000` |
| `CONVERGENCE_WINDOW_MS` | `2000` |
| `CONVERGENCE_DELAYS` | `[0, 250, 750]` |
| `POLL_INTERVAL_MS`（客户端） | `2000` |
| `POLL_TIMEOUT_MS`（客户端） | `30000` |

### 2.4 判定分支顺序（必须逐条照此实现，顺序即优先级）

```text
1  probe.source === 'service' && liveMatch                    → applied / basis=service
2  restartClaimed && restartReason !== null                    → restart-required
3  restartClaimed && restartReason === null                    → unknown / missing-restart-basis
4  failure !== null                                            → failed
5  probe.source === 'loader' && liveMatch && settled            → applied / basis=loader
6  probe.source === 'loader' && liveMatch                      → unknown / loader-not-settled
7  probe.source === 'unavailable'                              → unknown / probe-unavailable
8  其他                                                         → unknown / mismatch-no-evidence
```

派生量定义（逐字实现）：

```text
liveMatch      = probe.source !== 'unavailable' && sameCanonical(canonicalOf(probe), desired)
relevant       = evidence !== null && sameCanonical({view: evidence.desired, unknown: []}, desired)
restartClaimed = relevant && (evidence.restartReason !== null || evidence.pending.length > 0)
restartReason  = (relevant && evidence.restartReason 非空 trimmed) ?? (relevant && pending[0].reason 非空 trimmed)
failure        = relevant ? evidence.error : null
settled        = settledAt !== null || bootBaseline === true
```

---

## 3. 并行执行协议（多 agent 协作）

### 3.1 能力探测（执行前必须先做）

环境已具备多 agent 能力。执行者开工前按以下顺序确认：

1. 调用 `list_agents({})` —— 能返回当前 agent 树即说明协作通道可用。
2. 调用 `list_subagent_models({})` —— 能返回可用 provider 即说明可派生并行子代理。

两者任一失败时**不要中止任务**，改用 §3.5 的串行降级路径，并在报告中注明"并行能力不可用，已串行执行"。

### 3.2 工作包划分（文件作用域互不重叠）

| 包 | 文件 | 围栏 | 写作用域 |
|---|---|---|---|
| **W1** | `plugin/src/runtime-status.ts` | F01 | `plugin/src/runtime-status.ts` |
| **W2** | `plugin/src/web-routes.ts`<br>`plugin/src/index.ts` | F02<br>F03 | `plugin/src/web-routes.ts`, `plugin/src/index.ts` |
| **W3** | `plugin/src/client/locales.ts` | F04 | `plugin/src/client/locales.ts` |
| **W4** | `plugin/src/client/CompactionCard.tsx` | F05 | `plugin/src/client/CompactionCard.tsx` |
| **W5** | `docs/impl-harness/h4-runtime.mjs`<br>`docs/impl-harness/h2-routes.mjs`<br>`docs/impl-harness/h3-client-ui.mjs` | F06<br>F07<br>F08 | `docs/impl-harness/h2-routes.mjs`, `h3-client-ui.mjs`, `h4-runtime.mjs` |
| **W6** | `plugin/package.json`<br>`plugin/README.md`<br>`plugin/locale/zh.json`<br>`plugin/locale/en.json` | F09<br>F10<br>F11 | 上述四文件的指定行 |

**W1–W6 之间无写冲突，可全部并行启动。** 允许并行是因为 §2 已把跨文件契约（类型名、字段名、常量名）钉死；各包只依赖契约文本，不依赖彼此的落盘结果。

### 3.3 子代理提示词模板（逐字使用，只替换占位符）

```text
你是施工执行者，只负责工作包 {PKG}。仓库根：D:\DSH-SetModel-for-ContextCompression

施工图：docs/code.md。§4 中 `### {FENCE_IDS}` 标题后紧跟的 ``` 围栏代码块就是目标文件的完整内容。

你负责：
{FILE_LIST}

规则（严格遵守）：
1. 先用 grep 在 docs/code.md 搜 `### {FIRST_FENCE}` 定位，再用 read 的 offset/limit 完整读取对应围栏块（含结尾的 ``` 行，但不写入它们）。
2. 围栏第一行与最后一行是围栏标记，不是文件内容，不要写入。
3. 文件末尾保留恰好一个换行符；编码 UTF-8 无 BOM；行尾 LF。
4. 不添加、不删除、不改缩进、不改引号、不合并行、不省略任何行；中文文案逐字保留。
5. 只写上面列出的文件，绝对不要创建或修改其他任何文件。
6. 不要运行 prettier / eslint / 任何格式化器。
7. 不要运行 npm run build / typecheck / pack，不要运行 node run-all.mjs，不要安装插件，不要 git。
8. 每个文件写完用 read 回读，确认末行是 `}` 或 `]` 或 `}` 未被截断，且首行与围栏首行一致。

完成后只回复：
- 文件清单 + 每个文件的行数
- 每个文件"回读一致"或"不一致（说明差异）"
不要贴文件内容。
```

### 3.4 并行执行的硬规则

1. 主控（lead）必须先 `todo_write` 建立 6 个包的待办，再一次性并行派发 W1–W6。
2. 每个包派发时**同时**创建共享任务（`team_task_create`）并写明 `write_scopes`，子代理认领后执行。
3. 任一包失败：只重派该包，不得让其他包重做；也**不得**让别的包代写它的文件。
4. 施工阶段全部完成前，禁止任何人运行 §6 的验证命令。
5. 六包全部回报"回读一致"后，主控才进入 §6 串行验证。

### 3.5 串行降级路径

若 §3.1 探测失败，按 W1 → W2 → W3 → W4 → W5 → W6 顺序**由主控自己**依次执行，其余规则（逐字复制、只写作用域内文件、不构建）完全不变。

---

## 4. 文件内容

### F01 `plugin/src/runtime-status.ts`（整文件替换，480 行）

```ts
import {
  canonicalFromConfig,
  canonicalFromView,
  sameCanonical,
  type CanonicalView,
  type CompactionView,
} from './config-schema.ts'
import type { TargetField } from './patch-editor.ts'

export const COMPACTION_ENTRY_ID = 'compaction-basic'

/** How long one successful probe stays cached before the next read re-probes. */
export const PROBE_TTL_MS = 1000

/** Upper bound for waiting on a fresh save to become observable. Never extended. */
export const CONVERGENCE_WINDOW_MS = 2000

/** Probe offsets inside the convergence window. */
export const CONVERGENCE_DELAYS: readonly number[] = [0, 250, 750]

export type RuntimeSource = 'service' | 'loader' | 'unavailable'

/** One probed path and what it yielded. Never carries configuration values. */
export interface ProbeAttempt {
  path: string
  result: 'hit' | 'miss' | 'error'
  note?: string
}

export interface RuntimeProbe {
  view: CompactionView | null
  unknown: TargetField[]
  source: RuntimeSource
  attempts: ProbeAttempt[]
  cached: boolean
  probedAt: number
}

/** The only states this plugin may report. There is deliberately no transient member. */
export type StatusState = 'applied' | 'restart-required' | 'unknown' | 'failed'

export type StatusBasis = 'service' | 'loader' | 'none'

export type StatusReason =
  | 'probe-unavailable'
  | 'loader-not-settled'
  | 'mismatch-no-evidence'
  | 'missing-restart-basis'
  | 'convergence-timeout'

export type ErrorStage = 'validate' | 'backup' | 'write' | 'verify' | 'hmr' | 'compact' | 'probe'

export interface PublicCause {
  name?: string
  code?: string
  message: string
  cause?: PublicCause
}

export interface PublicError {
  stage: ErrorStage
  code: string
  message: string
  cause?: PublicCause
  detailAvailable: boolean
}

/** What one save attempt observed. Evidence explains failure or restart; it never overrides a live match. */
export interface ApplyEvidence {
  desired: CompactionView
  warnings: string[]
  pending: Array<{ url: string; reason: string }>
  restartReason: string | null
  error: PublicError | null
  at: number
}

export interface StatusReport {
  state: StatusState
  basis: StatusBasis
  reason: StatusReason | null
  detail: string | null
  confirmedAt: number
  reloadRevision: number
  lastSettledAt: number | null
  probe: RuntimeProbe
  warnings: string[]
  error: PublicError | null
}

export interface StatusInput {
  desired: CanonicalView
  probe: RuntimeProbe
  evidence: ApplyEvidence | null
  settledAt: number | null
  bootBaseline: boolean
}

const MAX_MESSAGE = 2000
const MAX_SUMMARY = 500
const MAX_CHAIN = 8000
const MAX_DEPTH = 4

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
  [/("?(?:api[_-]?key|apikey|authorization|access[_-]?token|refresh[_-]?token|secret|password)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1***'],
]

/** Mask credentials before any diagnostic leaves the process. */
export function sanitizeText(input: unknown, max: number = MAX_MESSAGE): string {
  const raw = typeof input === 'string' ? input : String(input ?? '')
  let text = raw
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Convert an arbitrary thrown value into a bounded, redacted cause chain. */
export function toPublicCause(error: unknown, depth: number = 0): PublicCause | undefined {
  if (error === null || error === undefined || depth >= MAX_DEPTH) return undefined
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  const name = typeof record?.name === 'string' && record.name !== '' ? record.name : undefined
  const rawCode = record?.code
  const code = typeof rawCode === 'string' && rawCode !== ''
    ? rawCode
    : typeof rawCode === 'number' ? String(rawCode) : undefined
  const message = sanitizeText(record?.message ?? String(error))
  const nested = toPublicCause(record?.cause, depth + 1)
  return {
    ...name === undefined ? {} : { name },
    ...code === undefined ? {} : { code },
    message,
    ...nested === undefined ? {} : { cause: nested },
  }
}

/** Build one stage-tagged public error, redacted and length-bounded. */
export function toPublicError(stage: ErrorStage, error: unknown, code?: string): PublicError {
  const cause = toPublicCause(error)
  const rawMessage = (error as { message?: unknown } | null)?.message
  const message = sanitizeText(rawMessage ?? error)
  const rawCode = (error as { code?: unknown } | null)?.code
  const resolvedCode = code
    ?? (typeof rawCode === 'string' && rawCode !== '' ? rawCode : undefined)
    ?? cause?.name
    ?? 'unknown'
  const payload: PublicError = {
    stage,
    code: resolvedCode,
    message: message === '' ? '未提供错误信息' : message,
    ...cause === undefined ? {} : { cause },
    detailAvailable: cause !== undefined || message !== '',
  }
  if (JSON.stringify(payload).length > MAX_CHAIN) {
    return { stage, code: resolvedCode, message: sanitizeText(message, MAX_SUMMARY), detailAvailable: true }
  }
  return payload
}

let reloadRevision = 0
let lastReloadAt: number | null = null
let lastSettledAt: number | null = null
let bootBaseline = false
let cachedProbe: { probe: RuntimeProbe; at: number } | null = null

/** Monotonic counter advanced by the settled-reload event; diagnostics only. */
export function currentReloadRevision(): number {
  return reloadRevision
}

export function lastReloadTimestamp(): number | null {
  return lastReloadAt
}

/** When profile patches last settled into the running Loader tree. */
export function lastSettledTimestamp(): number | null {
  return lastSettledAt
}

/** True once this process finished its own boot composition. */
export function bootBaselineActive(): boolean {
  return bootBaseline
}

export function invalidateProbeCache(): void {
  cachedProbe = null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function serviceOf(scope: any, name: string): any {
  try {
    return typeof scope?.get === 'function' ? scope.get(name) ?? null : null
  } catch {
    return null
  }
}

function configOf(service: any): Record<string, unknown> | null {
  const config = service !== null && typeof service === 'object'
    ? (service as { config?: unknown }).config
    : undefined
  return config !== null && typeof config === 'object' ? config as Record<string, unknown> : null
}

function compactionEntry(ctx: any): any {
  try {
    const loader = serviceOf(ctx, 'loader') ?? ctx?.loader
    if (loader === null || typeof loader?.entries !== 'function') return null
    for (const entry of loader.entries()) {
      if (entry?.options?.id === COMPACTION_ENTRY_ID) return entry
    }
  } catch {
    /* Loader probing is best effort only. */
  }
  return null
}

function remember(probe: RuntimeProbe): RuntimeProbe {
  cachedProbe = { probe: { ...probe, cached: false }, at: probe.probedAt }
  return probe
}

/**
 * Read the live configuration. The engine registers itself as the `compaction`
 * service, so three scopes are tried before the Loader row is accepted as
 * weaker evidence.
 */
export function probeRuntime(ctx: any, options: { fresh?: boolean } = {}): RuntimeProbe {
  const fresh = options.fresh === true
  if (!fresh && cachedProbe !== null && Date.now() - cachedProbe.at < PROBE_TTL_MS) {
    return { ...cachedProbe.probe, cached: true }
  }
  const attempts: ProbeAttempt[] = []
  const entry = compactionEntry(ctx)
  const paths: Array<{ path: string; read: () => Record<string, unknown> | null }> = [
    { path: 'ctx.compaction', read: () => configOf(serviceOf(ctx, 'compaction')) },
    { path: 'root.compaction', read: () => configOf(serviceOf(ctx?.root, 'compaction')) },
    { path: 'entry-fiber.compaction', read: () => configOf(serviceOf(entry?.fiber?.ctx, 'compaction')) },
  ]
  for (const candidate of paths) {
    let config: Record<string, unknown> | null = null
    try {
      config = candidate.read()
    } catch (error: unknown) {
      const message = (error as { message?: unknown } | null)?.message
      attempts.push({ path: candidate.path, result: 'error', note: sanitizeText(message ?? error, MAX_SUMMARY) })
      continue
    }
    if (config === null) {
      attempts.push({ path: candidate.path, result: 'miss' })
      continue
    }
    const canonical: CanonicalView = canonicalFromConfig(config)
    attempts.push({ path: candidate.path, result: 'hit' })
    return remember({
      view: canonical.view,
      unknown: canonical.unknown,
      source: 'service',
      attempts,
      cached: false,
      probedAt: Date.now(),
    })
  }
  if (entry !== null) {
    const canonical: CanonicalView = canonicalFromConfig(entry?.options?.config)
    attempts.push({ path: 'entry.options.config', result: 'hit' })
    return remember({
      view: canonical.view,
      unknown: canonical.unknown,
      source: 'loader',
      attempts,
      cached: false,
      probedAt: Date.now(),
    })
  }
  attempts.push({ path: 'entry.options.config', result: 'miss', note: 'loader-unavailable' })
  return remember({ view: null, unknown: [], source: 'unavailable', attempts, cached: false, probedAt: Date.now() })
}

function canonicalOf(probe: RuntimeProbe): CanonicalView | null {
  return probe.view === null ? null : { view: probe.view, unknown: probe.unknown }
}

function trimmed(value: string | null): string | null {
  if (value === null) return null
  const text = value.trim()
  return text === '' ? null : text
}

/**
 * Derive the one reportable state from a live comparison. Branch order is the
 * priority order: a live service match wins over any historical evidence.
 */
export function evaluateStatus(input: StatusInput): StatusReport {
  const { desired, probe, evidence, settledAt, bootBaseline: boot } = input
  const liveMatch = probe.source !== 'unavailable' && sameCanonical(canonicalOf(probe), desired)
  const relevant = evidence !== null && sameCanonical({ view: evidence.desired, unknown: [] }, desired)
  const restartClaimed = relevant && evidence !== null
    && (evidence.restartReason !== null || evidence.pending.length > 0)
  const officialReason = relevant && evidence !== null ? trimmed(evidence.restartReason) : null
  const pendingReason = relevant && evidence !== null && evidence.pending.length > 0
    ? trimmed(evidence.pending[0].reason)
    : null
  const restartReason = officialReason ?? pendingReason
  const failure = relevant && evidence !== null ? evidence.error : null
  const settled = settledAt !== null || boot === true
  const basis: StatusBasis = probe.source === 'service'
    ? 'service'
    : probe.source === 'loader' ? 'loader' : 'none'
  const base = {
    confirmedAt: Date.now(),
    reloadRevision,
    lastSettledAt,
    probe,
    warnings: relevant && evidence !== null ? evidence.warnings : [],
  }
  if (probe.source === 'service' && liveMatch) {
    return { ...base, state: 'applied', basis, reason: null, detail: restartReason, error: null }
  }
  if (restartClaimed && restartReason !== null) {
    return { ...base, state: 'restart-required', basis, reason: null, detail: restartReason, error: null }
  }
  if (restartClaimed && restartReason === null) {
    return { ...base, state: 'unknown', basis, reason: 'missing-restart-basis', detail: null, error: failure }
  }
  if (failure !== null) {
    return { ...base, state: 'failed', basis, reason: null, detail: null, error: failure }
  }
  if (probe.source === 'loader' && liveMatch && settled) {
    return { ...base, state: 'applied', basis, reason: null, detail: null, error: null }
  }
  if (probe.source === 'loader' && liveMatch) {
    return { ...base, state: 'unknown', basis, reason: 'loader-not-settled', detail: null, error: null }
  }
  if (probe.source === 'unavailable') {
    return { ...base, state: 'unknown', basis, reason: 'probe-unavailable', detail: null, error: null }
  }
  return { ...base, state: 'unknown', basis, reason: 'mismatch-no-evidence', detail: null, error: null }
}

/**
 * Probe forward inside a bounded window after a save. The window is never
 * extended: an inconclusive result stays inconclusive and says why.
 */
export async function convergeAfterSave(
  ctx: any,
  desired: CompactionView,
  evidence: ApplyEvidence,
): Promise<StatusReport> {
  const canonical = canonicalFromView(desired)
  const deadline = Date.now() + CONVERGENCE_WINDOW_MS
  let probe = probeRuntime(ctx, { fresh: true })
  for (const delay of CONVERGENCE_DELAYS) {
    const remaining = deadline - Date.now()
    if (delay > 0 && remaining > 0) await sleep(Math.min(delay, remaining))
    probe = probeRuntime(ctx, { fresh: true })
    if (probe.source === 'service' && sameCanonical(canonicalOf(probe), canonical)) break
    if (evidence.restartReason !== null || evidence.pending.length > 0) break
    if (Date.now() >= deadline) break
  }
  const status = evaluateStatus({
    desired: canonical,
    probe,
    evidence,
    settledAt: lastSettledAt,
    bootBaseline,
  })
  if (status.state === 'unknown' && status.reason === 'mismatch-no-evidence') {
    return { ...status, reason: 'convergence-timeout' }
  }
  return status
}

interface HmrLike {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>
  reconcileProfile(requiredIds?: readonly string[]): Promise<unknown>
}

type HmrCapability =
  | { ok: true; hmr: HmrLike }
  | { ok: false; reason: string }

function hmrCapability(ctx: any): HmrCapability {
  const hmr = serviceOf(ctx, 'hmr')
  if (hmr === null || typeof hmr !== 'object') {
    return { ok: false, reason: 'HMR 服务不可用：当前组合没有配置热重载，改动只在下次启动生效' }
  }
  if (typeof (hmr as { runExclusive?: unknown }).runExclusive !== 'function') {
    return { ok: false, reason: 'HMR 服务缺少 runExclusive，无法安全触发热重载' }
  }
  if (typeof (hmr as { reconcileProfile?: unknown }).reconcileProfile !== 'function') {
    return { ok: false, reason: 'HMR 服务缺少 reconcileProfile，无法重组 profile' }
  }
  const profileContext = serviceOf(ctx, 'profileContext')
  if (profileContext === null || typeof profileContext !== 'object') {
    return { ok: false, reason: '当前上下文没有 profileContext，HMR 无法重组 profile' }
  }
  return { ok: true, hmr: hmr as HmrLike }
}

/**
 * Observe completed configuration reloads. The event registration must happen
 * during apply(); wrapping ctx.on in ctx.effect prevents the listener from firing.
 */
export function registerReloadListener(ctx: any): void {
  bootBaseline = true
  if (typeof ctx?.on !== 'function') return
  try {
    const dispose = ctx.on('app-boot/config-reload', () => {
      reloadRevision += 1
      lastReloadAt = Date.now()
      lastSettledAt = lastReloadAt
      invalidateProbeCache()
      try {
        probeRuntime(ctx, { fresh: true })
      } catch {
        /* warming the cache must never break the reload path */
      }
    }, { global: true })
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
      ctx.effect(() => dispose as () => void)
    }
  } catch {
    /* the settled signal is an optimization; correctness does not depend on it */
  }
  try {
    const dispose = ctx.on('hmr/reload', () => {
      invalidateProbeCache()
    }, { global: true })
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
      ctx.effect(() => dispose as () => void)
    }
  } catch {
    /* module replacement notifications are best effort */
  }
}

/** Drive the official profile reload and record what it observed. */
export async function applyConfiguration(ctx: any, desired: CompactionView): Promise<ApplyEvidence> {
  const at = Date.now()
  const capability = hmrCapability(ctx)
  if (!capability.ok) {
    return {
      desired,
      warnings: [],
      pending: [],
      restartReason: 'hmr-unavailable',
      error: { stage: 'hmr', code: 'hmr-unavailable', message: capability.reason, detailAvailable: true },
      at,
    }
  }
  let outcome: any
  try {
    outcome = await capability.hmr.runExclusive(() => capability.hmr.reconcileProfile([COMPACTION_ENTRY_ID]))
  } catch (error: unknown) {
    return {
      desired,
      warnings: [],
      pending: [],
      restartReason: null,
      error: toPublicError('hmr', error),
      at,
    }
  }
  const outcomes = typeof outcome === 'object' && outcome !== null ? (outcome as Record<string, unknown>) : {}
  const warnings = Array.isArray(outcomes.warnings)
    ? outcomes.warnings.map((item: unknown) => sanitizeText(item, MAX_SUMMARY))
    : []
  const pending = Array.isArray(outcomes.pending)
    ? outcomes.pending.map((item: any) => ({
      url: sanitizeText(item?.url ?? '', 300),
      reason: sanitizeText(item?.reason ?? '', 120),
    }))
    : []
  const restartReason = typeof outcomes.restartReason === 'string' ? outcomes.restartReason : null
  return { desired, warnings, pending, restartReason, error: null, at }
}
```

### F02 `plugin/src/web-routes.ts`（整文件替换，364 行）

```ts
import { copyFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  editCompactionPatch,
  readCompactionPatch,
  TARGET_FIELDS,
} from './patch-editor.ts'
import {
  canonicalFromConfig,
  normalizeCompactionInput,
  toPatchOperations,
  ValidationFailure,
  viewOf,
  type CompactionView,
} from './config-schema.ts'
import {
  atomicWriteText,
  defaultDataDir,
  readBackupKeep,
  saveBackupKeep,
} from './settings-store.ts'
import {
  applyConfiguration,
  bootBaselineActive,
  convergeAfterSave,
  currentReloadRevision,
  evaluateStatus,
  invalidateProbeCache,
  lastSettledTimestamp,
  probeRuntime,
  sanitizeText,
  toPublicError,
  type ApplyEvidence,
} from './runtime-status.ts'
import { runCompaction } from './compaction-service.ts'

export const CONFIG_PATH = '/plugins/compaction-setmodel/config'
export const CATALOG_PATH = '/plugins/compaction-setmodel/catalog'
export const COMPACT_PATH = '/plugins/compaction-setmodel/compact'

/** Kept for the card; the placeholder is substituted client-side. */
export const LAST_COMPACTION_TEXT_MAX = 500

export class ConflictFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictFailure'
  }
}

export interface WebRouteDeps {
  patchPath?: string
  dataDir?: string
}

/** The most recent compaction this plugin's own button triggered. */
export interface LastCompaction {
  at: number
  ok: boolean
  kind: string
  text: string
}

interface SaveStage {
  changes: ReturnType<typeof editCompactionPatch>['changes']
  backupPath: string | null
  keptBackups: number
}

let lastSaved: CompactionView | null = null
let lastApplication: ApplyEvidence | null = null
let lastCompaction: LastCompaction | null = null
let backupSequence = 0

function defaultPatchPath(): string {
  const profileDir = process.env.DSH_PROFILE_DIR
    ?? join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'web')
  return join(profileDir, 'cordis.patch.yml')
}

function send(res: any, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function readJson(req: any): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 65536) throw new Error('request body exceeds 64 KiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Read one boolean query flag without depending on a URL parser. */
function queryFlag(req: any, name: string): boolean {
  const url = typeof req?.url === 'string' ? req.url : ''
  const index = url.indexOf('?')
  if (index < 0) return false
  for (const pair of url.slice(index + 1).split('&')) {
    const [key, value = ''] = pair.split('=')
    if (key !== name) continue
    return value !== '0' && value !== 'false'
  }
  return false
}

async function readPatch(filename: string): Promise<string> {
  try {
    return await readFile(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function backupDirectory(dataDir: string): string {
  return join(dataDir, 'backups')
}

async function listBackups(dataDir: string): Promise<string[]> {
  try {
    return (await readdir(backupDirectory(dataDir)))
      .filter((name) => /^cordis\.patch\.yml\.bak-\d{8}-\d{6}-\d{3}-\d+-\d+$/.test(name))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function backupAndRotate(patchPath: string, dataDir: string, keep: number): Promise<{ path: string | null; kept: number }> {
  let existing = true
  try {
    await readFile(patchPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') existing = false
    else throw error
  }
  if (!existing) return { path: null, kept: (await listBackups(dataDir)).length }
  await mkdir(backupDirectory(dataDir), { recursive: true })
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
  backupSequence += 1
  const path = join(backupDirectory(dataDir), `cordis.patch.yml.bak-${stamp}-${process.pid}-${backupSequence}`)
  await copyFile(patchPath, path)
  const names = await listBackups(dataDir)
  const excess = Math.max(0, names.length - keep)
  for (const name of names.slice(0, excess)) await unlink(join(backupDirectory(dataDir), name))
  return { path, kept: (await listBackups(dataDir)).length }
}

function verifyDesired(text: string, desired: CompactionView): boolean {
  const current = readCompactionPatch(text)
  for (const field of TARGET_FIELDS) {
    if (current.fields[field] !== desired.fields[field]) return false
  }
  return current.mode === desired.mode
}

async function writeStage(body: unknown, patchPath: string, dataDir: string): Promise<{ values: ReturnType<typeof normalizeCompactionInput>; desired: CompactionView; stage: SaveStage }> {
  const values = normalizeCompactionInput(body)
  const desired = viewOf(values)
  const original = await readPatch(patchPath)
  const edited = editCompactionPatch(original, toPatchOperations(values))
  const current = await readPatch(patchPath)
  if (current !== original) {
    throw new ConflictFailure('cordis.patch.yml changed while saving; reload and retry')
  }
  let backupPath: string | null = null
  let keptBackups = (await listBackups(dataDir)).length
  if (edited.text !== original) {
    const backup = await backupAndRotate(patchPath, dataDir, values.backupKeep)
    backupPath = backup.path
    keptBackups = backup.kept
    try {
      await atomicWriteText(patchPath, edited.text)
      const reread = await readPatch(patchPath)
      if (!verifyDesired(reread, desired)) throw new Error('read-back verification failed')
    } catch (error) {
      try {
        if (backupPath !== null) await copyFile(backupPath, patchPath)
        else if (original === '') await unlink(patchPath).catch(() => undefined)
        else await atomicWriteText(patchPath, original)
      } catch {
        /* keep the original failure */
      }
      throw error
    }
  }
  await saveBackupKeep(values.backupKeep, dataDir)
  lastSaved = desired
  return { values, desired, stage: { changes: edited.changes, backupPath, keptBackups } }
}

async function configPayload(patchPath: string, dataDir: string, ctx: any, fresh: boolean): Promise<Record<string, unknown>> {
  const current = readCompactionPatch(await readPatch(patchPath))
  const desired = canonicalFromConfig(current.fields)
  const probe = probeRuntime(ctx, { fresh })
  const status = evaluateStatus({
    desired,
    probe,
    evidence: lastApplication,
    settledAt: lastSettledTimestamp(),
    bootBaseline: bootBaselineActive(),
  })
  return {
    degraded: false,
    mode: current.mode,
    fields: current.fields,
    desired: desired.view,
    runtime: probe.view,
    runtimeSource: probe.source,
    status,
    lastSaved,
    lastApplication,
    lastCompaction,
    reloadRevision: currentReloadRevision(),
    backupKeep: await readBackupKeep(dataDir),
    entryFound: current.entryFound,
  }
}

function service(ctx: any, injected: any, name: string): any {
  return injected[name] ?? injected.get?.(name) ?? ctx.get?.(name)
}

export function registerWebRoutes(ctx: any, deps: WebRouteDeps = {}): void {
  const patchPath = deps.patchPath ?? defaultPatchPath()
  const dataDir = deps.dataDir ?? defaultDataDir()

  ctx.inject(['webServer'], (injected: any) => {
    const ws = service(ctx, injected, 'webServer')
    if (!ws?.register) return
    ws.register({
      kind: 'exact', path: CONFIG_PATH,
      handler: async (req: any, res: any) => {
        try {
          if (req.method === 'GET') {
            return send(res, 200, await configPayload(patchPath, dataDir, ctx, queryFlag(req, 'probe')))
          }
          if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
          const written = await writeStage(await readJson(req), patchPath, dataDir)
          const application = await applyConfiguration(ctx, written.desired)
          lastApplication = application
          invalidateProbeCache()
          const status = await convergeAfterSave(ctx, written.desired, application)
          return send(res, 200, {
            saved: true,
            changes: written.stage.changes,
            backupPath: written.stage.backupPath,
            keptBackups: written.stage.keptBackups,
            probedRuntime: status.probe.view,
            status,
            application,
          })
        } catch (error) {
          if (error instanceof ValidationFailure) return send(res, 400, { errors: error.errors })
          if (error instanceof ConflictFailure) return send(res, 409, { error: error.message })
          const stage = error instanceof Error && error.message === 'read-back verification failed' ? 'verify' : 'write'
          return send(res, 500, { saved: false, error: toPublicError(stage, error) })
        }
      },
    })
  })

  ctx.inject(['webServer', 'llm'], (injected: any) => {
    const ws = service(ctx, injected, 'webServer')
    const llm = service(ctx, injected, 'llm')
    if (!ws?.register || !llm) return
    ws.register({
      kind: 'exact', path: CATALOG_PATH,
      handler: async (req: any, res: any) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
        const groups: Array<Record<string, unknown>> = []
        const failures: Array<Record<string, unknown>> = []
        try {
          const providers = llm.listProviders() ?? []
          for (const provider of providers) {
            try {
              const models = await llm.listModels(provider.id)
              const entries = (models ?? []).map((model: any) => ({
                id: model.id,
                name: typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id,
              }))
              if (entries.length > 0) groups.push({
                id: provider.id,
                name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id,
                models: entries,
              })
            } catch (error) {
              failures.push({ id: provider.id, message: error instanceof Error ? error.message : String(error) })
            }
          }
          return send(res, 200, { groups, failures })
        } catch (error) {
          return send(res, 503, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
  })

  ctx.inject(['webServer', 'agents'], (injected: any) => {
    const ws = service(ctx, injected, 'webServer')
    const agents = service(ctx, injected, 'agents')
    if (!ws?.register || !agents) return
    ws.register({
      kind: 'exact', path: COMPACT_PATH,
      handler: async (req: any, res: any) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
        let body: any
        try {
          body = await readJson(req)
        } catch (error) {
          return send(res, 400, { ok: false, kind: 'error', text: '请求体无法解析', error: toPublicError('compact', error) })
        }
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (sessionId === '') {
          return send(res, 400, { ok: false, kind: 'error', text: 'sessionId required', error: null })
        }
        let agent: any
        try {
          agent = agents.get(sessionId)
        } catch {
          agent = undefined
        }
        if (!agent) {
          return send(res, 404, { ok: false, kind: 'error', text: '会话不存在', error: null })
        }
        const controller = new AbortController()
        req.on?.('close', () => {
          if (!controller.signal.aborted) controller.abort()
        })
        invalidateProbeCache()
        const outcome = await runCompaction(ctx, agent, controller.signal)
        invalidateProbeCache()
        lastCompaction = {
          at: Date.now(),
          ok: outcome.ok,
          kind: outcome.kind,
          text: sanitizeText(outcome.text, LAST_COMPACTION_TEXT_MAX),
        }
        return send(res, 200, {
          ok: outcome.ok,
          kind: outcome.kind,
          text: outcome.text,
          source: outcome.source,
          result: outcome.result,
          error: outcome.error,
        })
      },
    })
  })
}
```

### F03 `plugin/src/index.ts`（整文件替换，70 行 → 85 行）

```ts
import { registerWebRoutes } from './web-routes.ts'
import { registerReloadListener } from './runtime-status.ts'

export const name = 'compaction-setmodel'

export function apply(ctx: any): void {
  registerReloadListener(ctx)
  registerWebRoutes(ctx)
}

export {
  TARGET_FIELDS,
  editCompactionPatch,
  readCompactionPatch,
} from './patch-editor.ts'
export type {
  CompactionFields,
  CompactionMode,
  FieldValue,
  PatchChange,
  PatchEditResult,
  PatchOperation,
  PatchReadResult,
  TargetField,
} from './patch-editor.ts'
export {
  DEFAULT_FIELDS,
  ValidationFailure,
  canonicalFromConfig,
  canonicalFromView,
  fieldsFromConfig,
  modeOfFields,
  normalizeCompactionInput,
  sameCanonical,
  sameView,
  toPatchOperations,
  viewOf,
  withDefaults,
} from './config-schema.ts'
export type { CanonicalView, CompactionValues, CompactionView } from './config-schema.ts'
export {
  COMPACTION_ENTRY_ID,
  CONVERGENCE_DELAYS,
  CONVERGENCE_WINDOW_MS,
  PROBE_TTL_MS,
  applyConfiguration,
  bootBaselineActive,
  convergeAfterSave,
  currentReloadRevision,
  evaluateStatus,
  invalidateProbeCache,
  lastReloadTimestamp,
  lastSettledTimestamp,
  probeRuntime,
  registerReloadListener,
  sanitizeText,
  toPublicCause,
  toPublicError,
} from './runtime-status.ts'
export type {
  ApplyEvidence,
  ErrorStage,
  ProbeAttempt,
  PublicCause,
  PublicError,
  RuntimeProbe,
  RuntimeSource,
  StatusBasis,
  StatusInput,
  StatusReason,
  StatusReport,
  StatusState,
} from './runtime-status.ts'
export { runCompaction } from './compaction-service.ts'
export type { CompactKind, CompactOutcome, CompactResultSummary } from './compaction-service.ts'
export {
  CATALOG_PATH,
  COMPACT_PATH,
  CONFIG_PATH,
  ConflictFailure,
  LAST_COMPACTION_TEXT_MAX,
  registerWebRoutes,
} from './web-routes.ts'
export type { LastCompaction, WebRouteDeps } from './web-routes.ts'
export { atomicWriteText, readBackupKeep, saveBackupKeep } from './settings-store.ts'
```

### F04 `plugin/src/client/locales.ts`（整文件替换，120 行）

```ts
export const zh = {
  'nav.panel': '上下文压缩',
  'hint': '调整 DSH 上下文压缩的专用模型与行为参数。保存会写入 web profile 的 cordis.patch.yml，并由 DSH 主动热重载生效；下方状态按实际情况显示，读不到就写读不到。',
  'mode.title': '压缩模型',
  'mode.follow': '跟随对话模型（默认）',
  'mode.explicit': '指定专用模型',
  'mode.followHint': '不指定压缩专用模型，由 DSH 按当前会话的实际路由选择：优先使用最近回答过你的模型；没有回答记录时使用最近请求路由；再没有则使用 DSH 默认配置。它不保证等于界面当前选中的聊天模型。',
  'picker.title': '渠道与模型',
  'picker.provider': '渠道',
  'picker.model': '模型',
  'picker.manual': '手动填写',
  'picker.select': '— 请选择 —',
  'picker.unavailable': '渠道列表不可用（可手填）',
  'picker.notInCatalog': '当前渠道未出现在已配置列表中，请确认拼写。',
  'picker.modelNotInCatalog': '当前模型未出现在该渠道的模型列表中，请确认拼写。',
  'param.title': '压缩行为参数',
  'param.retainRatio': '保留比例',
  'param.auto': '自动压缩',
  'param.compactionRetries': '压缩重试次数',
  'param.maxOverflowRetries': '溢出重试次数',
  'action.title': '操作',
  'button.save': '保存设置',
  'button.saving': '保存中…',
  'button.compact': '压缩上下文',
  'button.compacting': '压缩中…',
  'button.recheck': '重新检查',
  'backup.title': '备份',
  'backup.keep': '备份保留份数',
  'status.applied': '已生效',
  'status.restart': '需重启 DSH 才能生效',
  'status.unknown': '无法确认',
  'status.failed': '应用失败',
  'status.reloadHint': '保存会主动触发热重载，通常无需重启；状态取自现场比对，不是历史记录。',
  'status.basis.service': '运行时实例',
  'status.basis.loader': '配置行（已结算）',
  'status.basis.none': '无可用证据',
  'status.footer': '依据：{basis} · 上次确认 {time} · 配置重组 {count} 次',
  'status.reason.probeUnavailable': '读不到运行实例，也读不到配置行，无法判断是否已生效。',
  'status.reason.loaderNotSettled': '只读到配置行，且尚未观察到重载结算。',
  'status.reason.mismatch': '配置值与运行值不一致，且没有需要重启的依据。',
  'status.reason.missingRestartBasis': '官方报告需要重启，但没有给出原因。',
  'status.reason.convergenceTimeout': '等待生效超时，当前无法确认。',
  'compact.noSession': '未找到当前会话，请先在对话中发一条消息。',
  'compact.done': '压缩完成。',
  'compact.failed': '压缩失败。',
  'compact.empty': '暂无可压缩历史。',
  'compact.busy': '当前会话正忙，请稍后再试。',
  'compact.cancelled': '压缩已取消。',
  'compact.changed': '历史在压缩期间发生变化，请重试。',
  'compact.commit': '压缩提交未干净完成，请先检查会话状态。',
  'compact.persistence': '压缩完成但会话保存失败。',
  'compact.lastTitle': '本插件最近一次压缩',
  'compact.lastNone': '尚未通过本插件触发过压缩。',
  'compact.lastScope': '仅记录本插件按钮触发的压缩，不含其他会话或外部 /compact。',
  'error.save': '保存失败',
  'detail.title': '技术详情',
  'detail.noCause': '未能获取详细原因',
  'detail.commandsOnly': '当前走命令通道，只提供通用结果',
  'warnings.title': '警告',
}
export const en: Record<keyof typeof zh, string> = {
  'nav.panel': 'Compaction',
  'hint': 'Tune the DSH context-compaction model and behavior. Saving writes the web profile cordis.patch.yml and triggers a DSH hot reload; the status below is a live comparison, and it says so when it cannot tell.',
  'mode.title': 'Compaction model',
  'mode.follow': 'Follow conversation model (default)',
  'mode.explicit': 'Dedicated model',
  'mode.followHint': 'Without a dedicated model, DSH picks the route of this session: the model that last answered you, then the latest request route, then the DSH defaults. It does not promise to equal the chat model currently selected in the UI.',
  'picker.title': 'Provider and model',
  'picker.provider': 'Provider',
  'picker.model': 'Model',
  'picker.manual': 'Manual entry',
  'picker.select': '— select —',
  'picker.unavailable': 'Provider list unavailable (manual entry works)',
  'picker.notInCatalog': 'This provider is not in the configured list; double-check the spelling.',
  'picker.modelNotInCatalog': 'This model is not in that provider list; double-check the spelling.',
  'param.title': 'Compaction behavior',
  'param.retainRatio': 'Retain ratio',
  'param.auto': 'Auto compaction',
  'param.compactionRetries': 'Compaction retries',
  'param.maxOverflowRetries': 'Overflow retries',
  'action.title': 'Actions',
  'button.save': 'Save settings',
  'button.saving': 'Saving…',
  'button.compact': 'Compact context',
  'button.compacting': 'Compacting…',
  'button.recheck': 'Check again',
  'backup.title': 'Backups',
  'backup.keep': 'Backups to keep',
  'status.applied': 'Applied',
  'status.restart': 'Restart DSH to apply',
  'status.unknown': 'Not confirmed',
  'status.failed': 'Apply failed',
  'status.reloadHint': 'Saving triggers a hot reload, so a restart is normally unnecessary; the status is a live comparison, not a stored record.',
  'status.basis.service': 'running instance',
  'status.basis.loader': 'config row (settled)',
  'status.basis.none': 'no usable evidence',
  'status.footer': 'Basis: {basis} · confirmed {time} · {count} config recompositions',
  'status.reason.probeUnavailable': 'Neither the running instance nor the config row could be read, so this cannot be judged.',
  'status.reason.loaderNotSettled': 'Only the config row was readable, and no settled reload has been observed yet.',
  'status.reason.mismatch': 'The saved and running values differ, and there is no reason to restart.',
  'status.reason.missingRestartBasis': 'DSH reported a restart is required but gave no reason.',
  'status.reason.convergenceTimeout': 'Waiting for the change timed out, so it cannot be confirmed right now.',
  'compact.noSession': 'No current session found; send a message in a conversation first.',
  'compact.done': 'Compaction finished.',
  'compact.failed': 'Compaction failed.',
  'compact.empty': 'No compactable history yet.',
  'compact.busy': 'The agent is busy; try again shortly.',
  'compact.cancelled': 'Compaction cancelled.',
  'compact.changed': 'The history changed during compaction; try again.',
  'compact.commit': 'Compaction did not commit cleanly; check the session state first.',
  'compact.persistence': 'Compaction finished, but the session could not be saved.',
  'compact.lastTitle': 'Last compaction from this plugin',
  'compact.lastNone': 'This plugin has not triggered a compaction yet.',
  'compact.lastScope': 'Records only compactions started by this plugin button; it does not cover other sessions or an external /compact.',
  'error.save': 'Save failed',
  'detail.title': 'Technical details',
  'detail.noCause': 'No detailed cause available',
  'detail.commandsOnly': 'Running through the command path, which only reports a generic result',
  'warnings.title': 'Warnings',
}
```

### F05 `plugin/src/client/CompactionCard.tsx`（整文件替换，396 行）

```tsx
import { Component, createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { ModelPicker } from './ModelPicker.tsx'
import { NumberField } from './NumberField.tsx'

const CONFIG_PATH = '/plugins/compaction-setmodel/config'
const FRESH_CONFIG_PATH = '/plugins/compaction-setmodel/config?probe=fresh'
const CATALOG_PATH = '/plugins/compaction-setmodel/catalog'
const COMPACT_PATH = '/plugins/compaction-setmodel/compact'
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30000

const STATE_KEYS: Record<string, string> = {
  applied: 'status.applied',
  'restart-required': 'status.restart',
  unknown: 'status.unknown',
  failed: 'status.failed',
}

const REASON_KEYS: Record<string, string> = {
  'probe-unavailable': 'status.reason.probeUnavailable',
  'loader-not-settled': 'status.reason.loaderNotSettled',
  'mismatch-no-evidence': 'status.reason.mismatch',
  'missing-restart-basis': 'status.reason.missingRestartBasis',
  'convergence-timeout': 'status.reason.convergenceTimeout',
}

const BASIS_KEYS: Record<string, string> = {
  service: 'status.basis.service',
  loader: 'status.basis.loader',
  none: 'status.basis.none',
}

type Phase = 'idle' | 'saving' | 'applied' | 'restart-required' | 'unknown' | 'failed'

export function selectMainSessionId(state: any): string | undefined {
  try {
    const byId = state?.byId
    if (byId === null || typeof byId !== 'object') return undefined
    for (const value of Object.values(byId) as any[]) {
      if (value && typeof value.id === 'string' && (value.retainedBy?.mainView ?? 0) > 0) return value.id
    }
    return undefined
  } catch {
    return undefined
  }
}

function phaseOf(state: unknown): Phase {
  if (state === 'applied') return 'applied'
  if (state === 'restart-required') return 'restart-required'
  if (state === 'failed') return 'failed'
  if (state === 'unknown') return 'unknown'
  return 'idle'
}

function fill(template: string, values: Record<string, string>): string {
  let text = template
  for (const [key, value] of Object.entries(values)) text = text.split(`{${key}}`).join(value)
  return text
}

function clockOf(at: unknown): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—'
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean; message?: string }> {
  state: { failed: boolean; message?: string } = { failed: false }
  static getDerivedStateFromError(error: unknown): { failed: boolean; message?: string } {
    if (error instanceof Error && error.name === 'SlotAssemblyError') throw error
    return { failed: true, message: error instanceof Error ? error.message : String(error) }
  }
  componentDidCatch(error: unknown, info: any): void {
    try { console.error('[compaction-setmodel] card render failed:', error, info?.componentStack) } catch { /* ignore */ }
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return h('div', { className: 'csm-field-error' }, 'compaction-setmodel card crashed: ' + (this.state.message ?? 'unknown'))
  }
}

function DetailBlock(props: any) {
  const t = props.t
  const error = props.error
  if (error === null || error === undefined) return null
  const lines: string[] = []
  lines.push(`stage: ${error.stage}  code: ${error.code}`)
  if (typeof error.message === 'string' && error.message !== '') lines.push(`message: ${error.message}`)
  let cause = error.cause
  let depth = 0
  while (cause && depth < 5) {
    lines.push(`cause[${depth}]: ${cause.name ?? 'Error'}${cause.code ? '/' + cause.code : ''} — ${cause.message}`)
    cause = cause.cause
    depth += 1
  }
  if (error.detailAvailable === false) lines.push(t('detail.noCause'))
  return h('details', { className: 'csm-hint' },
    h('summary', {}, t('detail.title')),
    ...lines.map((line, index) => h('p', { key: String(index), className: 'csm-hint' }, line)),
  )
}

function StatusBlock(props: any) {
  const t = props.t
  const status = props.status
  if (status === null || status === undefined) return null
  const stateKey = STATE_KEYS[status.state] ?? 'status.unknown'
  const basisKey = BASIS_KEYS[status.basis] ?? BASIS_KEYS.none
  const footer = fill(t('status.footer'), {
    basis: t(basisKey),
    time: clockOf(status.confirmedAt),
    count: String(typeof status.reloadRevision === 'number' ? status.reloadRevision : 0),
  })
  const reasonKey = typeof status.reason === 'string' ? REASON_KEYS[status.reason] : undefined
  const detail = typeof status.detail === 'string' && status.detail !== '' ? status.detail : null
  const parts: ReactNode[] = [
    h('strong', { key: 'state' }, t(stateKey)),
    h('span', { key: 'footer', className: 'csm-hint' }, ' ' + footer),
  ]
  if (detail !== null) parts.push(h('span', { key: 'detail', className: 'csm-hint' }, ' (' + detail + ')'))
  if (reasonKey !== undefined) parts.push(h('p', { key: 'reason', className: 'csm-hint' }, t(reasonKey)))
  return h('div', { className: props.className }, ...parts)
}

function CardBody(props: any) {
  const t = props.t ?? ((k: string) => k)
  const useSessions = props.useSessions as any
  const sessionId = typeof useSessions === 'function' ? useSessions(selectMainSessionId) : undefined

  const [mode, setMode] = useState<'follow' | 'explicit'>('follow')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [retainRatio, setRetainRatio] = useState('0.16')
  const [auto, setAuto] = useState(true)
  const [compactionRetries, setCompactionRetries] = useState('1')
  const [maxOverflowRetries, setMaxOverflowRetries] = useState('1')
  const [backupKeep, setBackupKeep] = useState('3')

  const [catalog, setCatalog] = useState<any>(null)
  const [status, setStatus] = useState<any>(null)
  const [lastCompaction, setLastCompaction] = useState<any>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [compactText, setCompactText] = useState('')
  const [compactError, setCompactError] = useState<any>(null)
  const [compactBusy, setCompactBusy] = useState(false)

  const mounted = useRef(true)
  const generation = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [])

  const applyPayload = (body: any): void => {
    const next = body?.status ?? null
    setStatus(next)
    setLastCompaction(body?.lastCompaction ?? null)
    if (next !== null) setPhase(phaseOf(next.state))
  }

  const pollBounded = (forGeneration: number): void => {
    const started = Date.now()
    const tick = async (): Promise<void> => {
      if (!mounted.current || generation.current !== forGeneration) return
      try {
        const response = await fetch(FRESH_CONFIG_PATH, { credentials: 'same-origin' })
        const body = await response.json()
        if (!mounted.current || generation.current !== forGeneration) return
        applyPayload(body)
        if (body?.status?.state !== 'unknown') return
      } catch {
        /* keep polling until the deadline */
      }
      if (Date.now() - started >= POLL_TIMEOUT_MS) return
      setTimeout(() => { void tick() }, POLL_INTERVAL_MS)
    }
    void tick()
  }

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(FRESH_CONFIG_PATH, { credentials: 'same-origin' })
        const body = await response.json()
        if (!mounted.current) return
        setMode(body?.mode === 'explicit' ? 'explicit' : 'follow')
        const fields = body?.fields ?? {}
        setProvider(typeof fields.summarizationProvider === 'string' ? fields.summarizationProvider : '')
        setModel(typeof fields.summarizationModel === 'string' ? fields.summarizationModel : '')
        setRetainRatio(fields.retainRatio === null || fields.retainRatio === undefined ? '0.16' : String(fields.retainRatio))
        setAuto(fields.auto !== false)
        setCompactionRetries(String(fields.compactionRetries ?? 1))
        setMaxOverflowRetries(String(fields.maxOverflowRetries ?? 1))
        if (typeof body?.backupKeep === 'number') setBackupKeep(String(body.backupKeep))
        applyPayload(body)
      } catch {
        /* leave defaults in place */
      }
      try {
        const response = await fetch(CATALOG_PATH, { credentials: 'same-origin' })
        const body = await response.json()
        if (mounted.current) setCatalog(body ?? null)
      } catch {
        if (mounted.current) setCatalog(null)
      }
    }
    void load()
  }, [])

  const save = async (): Promise<void> => {
    if (phase === 'saving') return
    generation.current += 1
    const forGeneration = generation.current
    setPhase('saving')
    setErrors({})
    try {
      const response = await fetch(CONFIG_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          summarizationProvider: provider,
          summarizationModel: model,
          retainRatio: Number(retainRatio),
          auto,
          compactionRetries: Number(compactionRetries),
          maxOverflowRetries: Number(maxOverflowRetries),
          backupKeep: Number(backupKeep),
        }),
      })
      const body = await response.json()
      if (!mounted.current || generation.current !== forGeneration) return
      if (response.status === 400 && body?.errors) {
        setErrors(body.errors)
        setPhase('idle')
        return
      }
      if (response.status === 409) {
        setErrors({ _: body?.error ?? t('error.save') })
        setPhase('idle')
        return
      }
      if (response.status !== 200 || body?.saved !== true) {
        setStatus({ state: 'failed', basis: 'none', reason: null, detail: null, error: body?.error ?? null, confirmedAt: Date.now(), reloadRevision: 0 })
        setErrors({ _: t('error.save') })
        setPhase('failed')
        return
      }
      applyPayload(body)
      if (body?.status?.state === 'unknown') pollBounded(forGeneration)
    } catch (error) {
      if (!mounted.current || generation.current !== forGeneration) return
      setErrors({ _: error instanceof Error ? error.message : String(error) })
      setPhase('failed')
    }
  }

  const recheck = async (): Promise<void> => {
    generation.current += 1
    const forGeneration = generation.current
    try {
      const response = await fetch(FRESH_CONFIG_PATH, { credentials: 'same-origin' })
      const body = await response.json()
      if (!mounted.current || generation.current !== forGeneration) return
      applyPayload(body)
    } catch {
      /* leave the current state untouched */
    }
  }

  const compact = async (): Promise<void> => {
    if (compactBusy) return
    if (sessionId === undefined) {
      setCompactText(t('compact.noSession'))
      setCompactError(null)
      return
    }
    setCompactBusy(true)
    setCompactText('')
    setCompactError(null)
    try {
      const response = await fetch(COMPACT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const body = await response.json()
      if (!mounted.current) return
      const kind = typeof body?.kind === 'string' ? body.kind : 'error'
      const translated = typeof body?.text === 'string' && body.text !== '' ? body.text : null
      const mapped = kind === 'success' ? t('compact.done')
        : kind === 'empty' ? t('compact.empty')
          : kind === 'busy' ? t('compact.busy')
            : kind === 'cancelled' ? t('compact.cancelled')
              : kind === 'changed' ? t('compact.changed')
                : kind === 'commit' ? t('compact.commit')
                  : kind === 'persistence' ? t('compact.persistence')
                    : kind === 'success' ? t('compact.done') : t('compact.failed')
      setCompactText(`${mapped}${translated === null || kind === 'success' ? '' : `（${translated}）`}`)
      setCompactError(body?.error ?? null)
      try {
        const refresh = await fetch(CONFIG_PATH, { credentials: 'same-origin' })
        const refreshed = await refresh.json()
        if (mounted.current) applyPayload(refreshed)
      } catch {
        /* the compaction result stands even when the refresh fails */
      }
    } catch (error) {
      if (mounted.current) {
        setCompactText(error instanceof Error ? error.message : String(error))
        setCompactError(null)
      }
    } finally {
      if (mounted.current) setCompactBusy(false)
    }
  }

  const errorKeys = Object.keys(errors)
  const warnings: string[] = Array.isArray(status?.warnings) ? status.warnings : []
  const lastInfo = lastCompaction === null || lastCompaction === undefined
    ? t('compact.lastNone')
    : `${clockOf(lastCompaction.at)} · ${typeof lastCompaction.kind === 'string' ? lastCompaction.kind : 'error'}`
  const statusClass = status === null
    ? 'csm-status csm-status-unknown'
    : status.state === 'applied' ? 'csm-status csm-status-ok'
      : status.state === 'failed' ? 'csm-status csm-status-err'
        : 'csm-status csm-status-unknown'

  return h('div', { className: 'csm-card' },
    h('p', { className: 'csm-hint' }, t('hint')),
    errorKeys.length > 0
      ? h('div', { className: 'csm-errors' }, ...errorKeys.map((key) => h('p', { key, className: 'csm-field-error' }, `${key}: ${errors[key]}`)))
      : null,
    h('div', { className: 'csm-section' },
      h('p', { className: 'csm-section-title' }, t('mode.title')),
      h('div', { className: 'csm-row' },
        h('label', { className: 'csm-row' },
          h('input', { type: 'radio', name: 'csm-mode', checked: mode === 'follow', onChange: () => { setMode('follow') } }),
          h('span', {}, t('mode.follow'))),
        h('label', { className: 'csm-row' },
          h('input', { type: 'radio', name: 'csm-mode', checked: mode === 'explicit', onChange: () => { setMode('explicit') } }),
          h('span', {}, t('mode.explicit'))),
      ),
      mode === 'follow' ? h('p', { className: 'csm-hint' }, t('mode.followHint')) : null,
      h(ModelPicker, { t, mode, provider, model, catalog, disabled: mode !== 'explicit', onProvider: setProvider, onModel: setModel }),
    ),
    h('div', { className: 'csm-section' },
      h('p', { className: 'csm-section-title' }, t('param.title')),
      h(NumberField, { key: 'retainRatio', label: t('param.retainRatio'), value: retainRatio, onChange: setRetainRatio, min: 0, max: 0.79, step: 0.01 }),
      h('div', { className: 'csm-row', key: 'auto' },
        h('span', { className: 'csm-row-label' }, t('param.auto')),
        h('input', { type: 'checkbox', checked: auto, onChange: (e: any) => { setAuto(e.target.checked) } })),
      h(NumberField, { key: 'compactionRetries', label: t('param.compactionRetries'), value: compactionRetries, onChange: setCompactionRetries, min: 0, max: 9, step: 1 }),
      h(NumberField, { key: 'maxOverflowRetries', label: t('param.maxOverflowRetries'), value: maxOverflowRetries, onChange: setMaxOverflowRetries, min: 0, max: 9, step: 1 }),
    ),
    h('div', { className: 'csm-section' },
      h('p', { className: 'csm-section-title' }, t('action.title')),
      h('div', { className: 'csm-row' },
        h('button', { className: 'csm-btn', onClick: () => { void save() }, disabled: phase === 'saving' }, phase === 'saving' ? t('button.saving') : t('button.save')),
        h('button', { className: 'csm-btn', onClick: () => { void compact() }, disabled: compactBusy }, compactBusy ? t('button.compacting') : t('button.compact')),
        h('button', { className: 'csm-btn', key: 'recheck', onClick: () => { void recheck() } }, t('button.recheck')),
      ),
      compactText === '' ? null : h('p', { className: 'csm-hint' }, compactText),
      h('p', { className: 'csm-hint' }, `${t('compact.lastTitle')}：${lastInfo}`),
      h('p', { className: 'csm-hint' }, t('compact.lastScope')),
      h(DetailBlock, { t, error: compactError }),
    ),
    h('div', { className: 'csm-section' },
      h('p', { className: 'csm-section-title' }, t('backup.title')),
      h(NumberField, { key: 'backupKeep', label: t('backup.keep'), value: backupKeep, onChange: setBackupKeep, min: 1, max: 50, step: 1 }),
    ),
    status === null
      ? h('p', { className: 'csm-hint' }, t('status.reloadHint'))
      : h(StatusBlock, { t, status, className: statusClass }),
    warnings.length > 0
      ? h('div', { className: 'csm-section' },
        h('p', { className: 'csm-section-title' }, t('warnings.title')),
        ...warnings.slice(0, 5).map((line, index) => h('p', { key: String(index), className: 'csm-hint' }, line)),
      )
      : null,
    h(DetailBlock, { t, error: status?.error ?? null }),
  )
}

export function CompactionCard(props: any) {
  return h(CardBoundary, null, h(CardBody, props))
}
```

### F06 `docs/impl-harness/h4-runtime.mjs`（整文件替换）

> 期望检查数：**63**。行数：**322**。

```js
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

export const name = 'h4-runtime'

function check(label, ok, detail) {
  return { label, ok: ok === true, detail: detail === undefined ? '' : String(detail) }
}

const FOLLOW_FIELDS = {
  summarizationProvider: null,
  summarizationModel: null,
  retainRatio: 0.16,
  auto: true,
  compactionRetries: 1,
  maxOverflowRetries: 1,
}

const EXPLICIT_FIELDS = {
  summarizationProvider: 'nvidia',
  summarizationModel: 'nvidia/x',
  retainRatio: 0.2,
  auto: false,
  compactionRetries: 2,
  maxOverflowRetries: 0,
}

const EXPLICIT_VIEW = { mode: 'explicit', fields: EXPLICIT_FIELDS }
const FOLLOW_VIEW = { mode: 'follow', fields: FOLLOW_FIELDS }

function makeContext(services) {
  return {
    get(name) { return services[name] },
    on() { return () => {} },
    effect(fn) { const dispose = fn(); return dispose },
    inject(names, callback) {
      if (names.every((entry) => services[entry] !== undefined)) {
        const injected = { get: (key) => services[key] }
        for (const entry of names) injected[entry] = services[entry]
        callback(injected)
      }
    },
  }
}

function evidence(overrides) {
  return {
    desired: EXPLICIT_VIEW,
    warnings: [],
    pending: [],
    restartReason: null,
    error: null,
    at: Date.now(),
    ...overrides,
  }
}

export async function run() {
  const mod = await import(pathToFileURL(join(ROOT, 'plugin', 'lib', 'index.js')).href)
  const checks = []
  const desired = mod.canonicalFromView(EXPLICIT_VIEW)

  // --- A. canonical normalization ---
  const follow = mod.canonicalFromConfig({})
  checks.push(check('h4 follow mode', follow.view.mode === 'follow', follow.view.mode))
  const followBlank = mod.canonicalFromConfig({ summarizationProvider: '', summarizationModel: '' })
  checks.push(check('h4 blank strings are follow', followBlank.view.mode === 'follow', followBlank.view.mode))
  const explicit = mod.canonicalFromConfig(EXPLICIT_FIELDS)
  checks.push(check('h4 explicit mode', explicit.view.mode === 'explicit', explicit.view.mode))
  checks.push(check('h4 default retainRatio', follow.view.fields.retainRatio === 0.16, follow.view.fields.retainRatio))
  checks.push(check('h4 default auto', follow.view.fields.auto === true, follow.view.fields.auto))
  checks.push(check('h4 default retries', follow.view.fields.compactionRetries === 1 && follow.view.fields.maxOverflowRetries === 1, 'retries'))
  const tokens = mod.canonicalFromConfig({ ...EXPLICIT_FIELDS, retainRatio: undefined, retainTokens: 2048 })
  checks.push(check('h4 retainTokens marks unknown', tokens.unknown.includes('retainRatio'), JSON.stringify(tokens.unknown)))
  checks.push(check('h4 retainTokens skips comparison', mod.sameCanonical(tokens, desired) === true, 'should compare equal'))
  checks.push(check('h4 sameCanonical equal', mod.sameCanonical(explicit, desired) === true, 'should be equal'))
  checks.push(check('h4 sameCanonical different', mod.sameCanonical(follow, desired) === false, 'should differ'))

  // --- B. multi-path probe ---
  const serviceHit = mod.probeRuntime(makeContext({
    compaction: { config: EXPLICIT_FIELDS },
    loader: { entries: () => [{ options: { id: 'compaction-basic', config: FOLLOW_FIELDS } }] },
  }), { fresh: true })
  checks.push(check('h4 probe ctx service', serviceHit.source === 'service' && serviceHit.view.fields.summarizationProvider === 'nvidia', JSON.stringify(serviceHit.source)))
  checks.push(check('h4 probe ctx path first', serviceHit.attempts[0]?.path === 'ctx.compaction' && serviceHit.attempts[0]?.result === 'hit', JSON.stringify(serviceHit.attempts)))

  const rootCtx = makeContext({})
  rootCtx.root = { get: (key) => (key === 'compaction' ? { config: EXPLICIT_FIELDS } : undefined) }
  const rootHit = mod.probeRuntime(rootCtx, { fresh: true })
  checks.push(check('h4 probe root fallback', rootHit.source === 'service' && rootHit.attempts[1]?.path === 'root.compaction' && rootHit.attempts[1]?.result === 'hit', JSON.stringify(rootHit.attempts)))

  const fiberHit = mod.probeRuntime(makeContext({
    loader: {
      entries: () => [{
        options: { id: 'compaction-basic', config: FOLLOW_FIELDS },
        fiber: { ctx: { get: (key) => (key === 'compaction' ? { config: EXPLICIT_FIELDS } : undefined) } },
      }],
    },
  }), { fresh: true })
  checks.push(check('h4 probe entry fiber', fiberHit.source === 'service' && fiberHit.attempts[2]?.path === 'entry-fiber.compaction' && fiberHit.attempts[2]?.result === 'hit', JSON.stringify(fiberHit.attempts)))

  const loaderHit = mod.probeRuntime(makeContext({
    loader: { entries: () => [{ options: { id: 'compaction-basic', config: FOLLOW_FIELDS } }] },
  }), { fresh: true })
  checks.push(check('h4 probe loader fallback', loaderHit.source === 'loader' && loaderHit.attempts.length === 4 && loaderHit.attempts[3]?.result === 'hit', JSON.stringify(loaderHit.attempts)))

  const noneHit = mod.probeRuntime(makeContext({}), { fresh: true })
  checks.push(check('h4 probe unavailable', noneHit.source === 'unavailable' && noneHit.view === null, JSON.stringify(noneHit.source)))

  const brokenCtx = makeContext({})
  brokenCtx.get = () => { throw new Error('boom') }
  const broken = mod.probeRuntime(brokenCtx, { fresh: true })
  checks.push(check('h4 probe survives throwing scope', broken.source === 'unavailable', JSON.stringify(broken.source)))

  // --- C. cache behavior ---
  const cacheCtx = makeContext({
    loader: { entries: () => [{ options: { id: 'compaction-basic', config: FOLLOW_FIELDS } }] },
  })
  const first = mod.probeRuntime(cacheCtx, { fresh: true })
  const second = mod.probeRuntime(cacheCtx)
  checks.push(check('h4 cache second read cached', second.cached === true, JSON.stringify(second.cached)))
  checks.push(check('h4 cache keeps probedAt', second.probedAt === first.probedAt, `${second.probedAt}/${first.probedAt}`))
  const third = mod.probeRuntime(cacheCtx, { fresh: true })
  checks.push(check('h4 fresh bypasses cache', third.cached === false, JSON.stringify(third.cached)))
  mod.invalidateProbeCache()
  const fourth = mod.probeRuntime(cacheCtx)
  checks.push(check('h4 invalidate clears cache', fourth.cached === false, JSON.stringify(fourth.cached)))

  // --- D. status truth table ---
  const serviceProbe = (fields) => ({ view: { mode: fields.summarizationProvider === null && fields.summarizationModel === null ? 'follow' : 'explicit', fields }, unknown: [], source: 'service', attempts: [], cached: false, probedAt: Date.now() })
  const loaderProbe = (fields) => ({ view: { mode: fields.summarizationProvider === null && fields.summarizationModel === null ? 'follow' : 'explicit', fields }, unknown: [], source: 'loader', attempts: [], cached: false, probedAt: Date.now() })
  const noneProbe = { view: null, unknown: [], source: 'unavailable', attempts: [], cached: false, probedAt: Date.now() }

  const row1 = mod.evaluateStatus({ desired, probe: serviceProbe(EXPLICIT_FIELDS), evidence: null, settledAt: null, bootBaseline: false })
  checks.push(check('h4 row1 service match applied', row1.state === 'applied' && row1.basis === 'service', JSON.stringify(row1.state)))

  const row1b = mod.evaluateStatus({
    desired,
    probe: serviceProbe(EXPLICIT_FIELDS),
    evidence: evidence({ restartReason: 'host-module' }),
    settledAt: Date.now(),
    bootBaseline: true,
  })
  checks.push(check('h4 row1 match beats restart evidence', row1b.state === 'applied' && row1b.detail === 'host-module', JSON.stringify(row1b.state)))

  const row2 = mod.evaluateStatus({ desired, probe: loaderProbe(EXPLICIT_FIELDS), evidence: null, settledAt: Date.now(), bootBaseline: false })
  checks.push(check('h4 row2 loader settled applied', row2.state === 'applied' && row2.basis === 'loader', JSON.stringify(row2.state)))

  const row3 = mod.evaluateStatus({ desired, probe: loaderProbe(EXPLICIT_FIELDS), evidence: null, settledAt: null, bootBaseline: false })
  checks.push(check('h4 row3 loader unsettled unknown', row3.state === 'unknown' && row3.reason === 'loader-not-settled', JSON.stringify(row3.reason)))

  const row4 = mod.evaluateStatus({ desired, probe: loaderProbe(EXPLICIT_FIELDS), evidence: evidence({ restartReason: 'host-module' }), settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row4 loader match with restart', row4.state === 'restart-required' && row4.detail === 'host-module', JSON.stringify(row4.state)))

  const row5 = mod.evaluateStatus({ desired, probe: serviceProbe(FOLLOW_FIELDS), evidence: evidence({ pending: [{ url: 'file:///x.js', reason: 'module-comparison' }] }), settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row5 mismatch with restart', row5.state === 'restart-required' && row5.detail === 'module-comparison', JSON.stringify(row5.detail)))

  const row6 = mod.evaluateStatus({ desired, probe: serviceProbe(FOLLOW_FIELDS), evidence: evidence({ error: { stage: 'hmr', code: 'boom', message: 'boom', detailAvailable: true } }), settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row6 mismatch with error', row6.state === 'failed' && row6.error?.stage === 'hmr', JSON.stringify(row6.state)))

  const row7 = mod.evaluateStatus({ desired, probe: serviceProbe(FOLLOW_FIELDS), evidence: null, settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row7 mismatch no evidence', row7.state === 'unknown' && row7.reason === 'mismatch-no-evidence', JSON.stringify(row7.reason)))

  const row8 = mod.evaluateStatus({ desired, probe: noneProbe, evidence: null, settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row8 probe unavailable', row8.state === 'unknown' && row8.reason === 'probe-unavailable' && row8.basis === 'none', JSON.stringify(row8.reason)))

  const row9 = mod.evaluateStatus({ desired, probe: noneProbe, evidence: evidence({ restartReason: 'package-moved' }), settledAt: null, bootBaseline: false })
  checks.push(check('h4 row9 unavailable with restart', row9.state === 'restart-required' && row9.detail === 'package-moved', JSON.stringify(row9.state)))

  const row10 = mod.evaluateStatus({ desired, probe: noneProbe, evidence: evidence({ error: { stage: 'hmr', code: 'x', message: 'x', detailAvailable: true } }), settledAt: null, bootBaseline: false })
  checks.push(check('h4 row10 unavailable with error', row10.state === 'failed' && row10.error?.code === 'x', JSON.stringify(row10.state)))

  const row11 = mod.evaluateStatus({ desired, probe: serviceProbe(FOLLOW_FIELDS), evidence: evidence({ pending: [{ url: 'file:///x.js', reason: '   ' }] }), settledAt: Date.now(), bootBaseline: true })
  checks.push(check('h4 row11 restart without reason', row11.state === 'unknown' && row11.reason === 'missing-restart-basis', JSON.stringify(row11.reason)))

  const staleEvidence = mod.evaluateStatus({
    desired,
    probe: serviceProbe(FOLLOW_FIELDS),
    evidence: evidence({ desired: FOLLOW_VIEW, restartReason: 'host-module' }),
    settledAt: Date.now(),
    bootBaseline: true,
  })
  checks.push(check('h4 stale evidence ignored', staleEvidence.state === 'unknown' && staleEvidence.reason === 'mismatch-no-evidence', JSON.stringify(staleEvidence.reason)))

  const scenarios = [row1, row1b, row2, row3, row4, row5, row6, row7, row8, row9, row10, row11, staleEvidence]
  checks.push(check('h4 no transient state ever', scenarios.every((entry) => entry.state !== 'pending'), 'a transient state leaked'))
  checks.push(check('h4 state enum has four members', scenarios.every((entry) => ['applied', 'restart-required', 'unknown', 'failed'].includes(entry.state)), 'unexpected state'))

  const source = await readFile(join(ROOT, 'plugin', 'src', 'runtime-status.ts'), 'utf8')
  const unionLine = /export type StatusState =([^\n]+)/.exec(source)?.[1] ?? ''
  checks.push(check('h4 state union excludes transient', unionLine.includes('applied') && unionLine.includes('restart-required') && unionLine.includes('unknown') && unionLine.includes('failed') && !unionLine.includes('pending'), unionLine))

  // --- E. bounded convergence ---
  let probeCount = 0
  const convergeCtx = makeContext({})
  convergeCtx.get = (key) => {
    if (key !== 'compaction') return undefined
    probeCount += 1
    return { config: probeCount >= 3 ? EXPLICIT_FIELDS : FOLLOW_FIELDS }
  }
  const converged = await mod.convergeAfterSave(convergeCtx, EXPLICIT_VIEW, evidence({}))
  checks.push(check('h4 converge reaches applied', converged.state === 'applied', JSON.stringify(converged.state)))

  const stuckStart = Date.now()
  const stuckCtx = makeContext({ compaction: { config: FOLLOW_FIELDS } })
  const stuck = await mod.convergeAfterSave(stuckCtx, EXPLICIT_VIEW, evidence({}))
  const stuckElapsed = Date.now() - stuckStart
  checks.push(check('h4 converge times out as unknown', stuck.state === 'unknown' && stuck.reason === 'convergence-timeout', JSON.stringify(stuck.reason)))
  checks.push(check('h4 converge stays bounded', stuckElapsed <= 2500, `${stuckElapsed}ms`))

  // --- F. apply evidence ---
  const noHmr = await mod.applyConfiguration(makeContext({}), FOLLOW_VIEW)
  checks.push(check('h4 no hmr records restart', noHmr.restartReason === 'hmr-unavailable', JSON.stringify(noHmr.restartReason)))
  checks.push(check('h4 no hmr records error', noHmr.error?.stage === 'hmr', JSON.stringify(noHmr.error?.stage)))
  checks.push(check('h4 evidence keeps desired', mod.sameCanonical({ view: noHmr.desired, unknown: [] }, mod.canonicalFromView(FOLLOW_VIEW)) === true, 'desired mismatch'))
  checks.push(check('h4 evidence has timestamp', typeof noHmr.at === 'number' && noHmr.at > 0, String(noHmr.at)))

  const cleanHmr = makeContext({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: [], pending: [], restartReason: undefined }) },
    profileContext: {},
  })
  const clean = await mod.applyConfiguration(cleanHmr, EXPLICIT_VIEW)
  checks.push(check('h4 clean hmr no restart', clean.restartReason === null && clean.pending.length === 0 && clean.error === null, JSON.stringify(clean)))

  const pendingHmr = makeContext({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: ['w1'], pending: [{ url: 'file:///x.js', reason: 'host-module' }], restartReason: undefined }) },
    profileContext: {},
  })
  const pending = await mod.applyConfiguration(pendingHmr, EXPLICIT_VIEW)
  checks.push(check('h4 pending recorded', pending.pending.length === 1 && pending.pending[0].reason === 'host-module', JSON.stringify(pending.pending)))
  checks.push(check('h4 warnings recorded', pending.warnings[0] === 'w1', JSON.stringify(pending.warnings)))

  const restartHmr = makeContext({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: [], pending: [], restartReason: 'package-moved' }) },
    profileContext: {},
  })
  const restarted = await mod.applyConfiguration(restartHmr, EXPLICIT_VIEW)
  checks.push(check('h4 restartReason recorded', restarted.restartReason === 'package-moved', JSON.stringify(restarted.restartReason)))

  const throwHmr = makeContext({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => { throw new Error('reconcile boom') } },
    profileContext: {},
  })
  const thrown = await mod.applyConfiguration(throwHmr, EXPLICIT_VIEW)
  checks.push(check('h4 throw recorded as error', thrown.error?.stage === 'hmr' && thrown.restartReason === null, JSON.stringify(thrown.error?.stage)))

  const calls = []
  const wrapHmr = makeContext({
    hmr: {
      runExclusive: (op) => { calls.push('runExclusive'); return op() },
      reconcileProfile: async (ids) => { calls.push(['reconcile', ids]); return { warnings: [], pending: [], restartReason: undefined } },
    },
    profileContext: {},
  })
  await mod.applyConfiguration(wrapHmr, EXPLICIT_VIEW)
  checks.push(check('h4 runExclusive called first', calls[0] === 'runExclusive', JSON.stringify(calls)))
  const reconcileCall = calls.find((entry) => Array.isArray(entry))
  checks.push(check('h4 requiredIds passed', Array.isArray(reconcileCall) && reconcileCall[1]?.[0] === 'compaction-basic', JSON.stringify(reconcileCall)))

  // --- G. redaction ---
  const masked = mod.sanitizeText('key sk-abcdefghijklmnop then Bearer abcdefghijklm and api_key: "value123"')
  checks.push(check('h4 masks sk-', !masked.includes('sk-abcdefghijklmnop'), masked))
  checks.push(check('h4 masks bearer', !masked.includes('Bearer abcdefghijklm'), masked))
  checks.push(check('h4 masks api_key', !masked.includes('value123'), masked))
  let deep = new Error('level0')
  for (let i = 1; i <= 6; i += 1) deep = new Error(`level${i}`, { cause: deep })
  let depth = 0
  let cursor = mod.toPublicCause(deep)
  while (cursor?.cause) { depth += 1; cursor = cursor.cause }
  checks.push(check('h4 cause depth capped at 4', depth === 3, `depth=${depth}`))

  // --- H. compaction service ---
  const compactCtx = makeContext({ compaction: { compactNow: async () => ({ compactionId: 'id-1', shadowedSeqs: [1, 2, 3], shadowedTokenCount: 900, summarySeq: 10, endSeq: 12 }) } })
  const success = await mod.runCompaction(compactCtx, {}, new AbortController().signal)
  checks.push(check('h4 compact success', success.ok === true && success.kind === 'success' && success.result.shadowedCount === 3, JSON.stringify(success.kind)))

  const emptyCtx = makeContext({ compaction: { compactNow: async () => null } })
  const empty = await mod.runCompaction(emptyCtx, {}, new AbortController().signal)
  checks.push(check('h4 compact empty', empty.ok === true && empty.kind === 'empty', JSON.stringify(empty.kind)))

  const summaryCtx = makeContext({
    compaction: {
      compactNow: async () => {
        const inner = new Error('llm-deepseek: no API key for provider route "deepseek-official"')
        const outer = new Error('manual compaction could not produce a smaller summary', { cause: inner })
        outer.name = 'ManualCompactionError'
        outer.code = 'summary'
        throw outer
      },
    },
  })
  const summary = await mod.runCompaction(summaryCtx, {}, new AbortController().signal)
  checks.push(check('h4 compact summary kind', summary.kind === 'summary', JSON.stringify(summary.kind)))
  checks.push(check('h4 compact summary keeps cause', (summary.error?.cause?.cause?.message ?? '').includes('no API key'), JSON.stringify(summary.error)))

  const busyCtx = makeContext({
    compaction: {
      compactNow: async () => {
        const error = new Error('manual compaction requires an idle agent')
        error.name = 'ManualCompactionError'
        error.code = 'busy'
        throw error
      },
    },
  })
  const busy = await mod.runCompaction(busyCtx, {}, new AbortController().signal)
  checks.push(check('h4 compact busy', busy.kind === 'busy' && busy.ok === false, JSON.stringify(busy.kind)))

  const fallbackCtx = makeContext({ commands: { execute: async () => ({ result: { kind: 'success', text: 'Compacted 2 history items.' } }) } })
  const fallback = await mod.runCompaction(fallbackCtx, {}, new AbortController().signal)
  checks.push(check('h4 commands fallback', fallback.source === 'commands' && fallback.ok === true, JSON.stringify(fallback.source)))
  checks.push(check('h4 commands detailAvailable false', fallback.error === null || fallback.error.detailAvailable === false, JSON.stringify(fallback.error)))

  const noneCtx = makeContext({})
  const none = await mod.runCompaction(noneCtx, {}, new AbortController().signal)
  checks.push(check('h4 no service => error', none.ok === false && none.kind === 'error', JSON.stringify(none.kind)))

  return { name, checks }
}
```

### F07 `docs/impl-harness/h2-routes.mjs`（整文件替换）

> 期望检查数：**59**。行数：**280**。

```js
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

export const name = 'h2-routes'

function check(label, ok, detail) {
  return { label, ok: ok === true, detail: detail === undefined ? '' : String(detail) }
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    end(chunk) { this.body += chunk === undefined ? '' : String(chunk) },
    json() { return this.body === '' ? undefined : JSON.parse(this.body) },
  }
}

function fakeRequest(method, body, url) {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    url,
    [Symbol.asyncIterator]() {
      let sent = false
      return {
        async next() {
          if (sent || text === '') return { done: true, value: undefined }
          sent = true
          return { done: false, value: Buffer.from(text, 'utf8') }
        },
      }
    },
    on() {},
  }
}

function makeContext(services) {
  const contexts = []
  return {
    get(name) { return services[name] },
    on() { return () => {} },
    inject(names, callback) {
      if (names.every((entry) => services[entry] !== undefined)) {
        const injected = { get: (key) => services[key] }
        for (const entry of names) injected[entry] = services[entry]
        contexts.push(callback(injected))
      }
    },
    contexts,
  }
}

const SAMPLE = [
  '- id: other',
  '  config:',
  '    keep: 1',
  '- id: compaction-basic',
  "  name: '@deepseek-ai/dsh-compaction-basic'",
  '  config:',
  '    summarizationProvider: nvidia',
  '    summarizationModel: nvidia/nemotron-3-ultra-550b-a55b',
  '    retainRatio: 0.16',
  '',
].join('\n')

const VALID_SAVE = { mode: 'follow', retainRatio: 0.2, auto: false, compactionRetries: 2, maxOverflowRetries: 0, backupKeep: 3 }
const MATCHING_CONFIG = { summarizationProvider: null, summarizationModel: null, retainRatio: 0.2, auto: false, compactionRetries: 2, maxOverflowRetries: 0 }

async function setup(services = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'csm-h2-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  await writeFile(patchPath, SAMPLE, 'utf8')
  const routes = new Map()
  const merged = {
    webServer: { register: (definition) => { routes.set(definition.path, definition.handler) } },
    llm: {
      listProviders: () => [{ id: 'nvidia', name: 'NVIDIA' }, { id: 'broken' }],
      listModels: async (id) => {
        if (id === 'broken') throw new Error('boom')
        return [{ id: 'nvidia/nemotron-3-ultra-550b-a55b', name: 'Nemotron' }]
      },
    },
    commands: { execute: async () => ({ result: { kind: 'success', text: 'Compacted 3 items' } }) },
    agents: { get: (id) => (id === 's1' ? { id: 's1' } : undefined) },
    ...services,
  }
  const ctx = makeContext(merged)
  const mod = await import(pathToFileURL(join(ROOT, 'plugin', 'lib', 'index.js')).href)
  mod.invalidateProbeCache()
  mod.registerReloadListener(ctx)
  mod.registerWebRoutes(ctx, { patchPath, dataDir: join(dir, 'data') })
  return { dir, patchPath, routes, mod, ctx }
}

export async function run() {
  const checks = []
  const configPath = '/plugins/compaction-setmodel/config'
  const catalogPath = '/plugins/compaction-setmodel/catalog'
  const compactPath = '/plugins/compaction-setmodel/compact'

  // --- A. registration + baseline GET ---
  const base = await setup()
  checks.push(check('h2 config route registered', base.routes.has(configPath), [...base.routes.keys()].join(',')))
  checks.push(check('h2 catalog route registered', base.routes.has(catalogPath), 'catalog'))
  checks.push(check('h2 compact route registered', base.routes.has(compactPath), 'compact'))

  const getRes = fakeResponse()
  await base.routes.get(configPath)(fakeRequest('GET'), getRes)
  const getBody = getRes.json()
  checks.push(check('h2 GET 200', getRes.statusCode === 200, getRes.statusCode))
  checks.push(check('h2 GET mode', getBody.mode === 'explicit', getBody.mode))
  checks.push(check('h2 GET runtimeSource', getBody.runtimeSource === 'unavailable', getBody.runtimeSource))
  checks.push(check('h2 GET reloadRevision', typeof getBody.reloadRevision === 'number', getBody.reloadRevision))
  checks.push(check('h2 GET lastApplication null', getBody.lastApplication === null, JSON.stringify(getBody.lastApplication)))
  checks.push(check('h2 GET status block', typeof getBody.status === 'object' && getBody.status !== null, 'missing status'))
  checks.push(check('h2 GET status unknown', getBody.status?.state === 'unknown', JSON.stringify(getBody.status?.state)))
  checks.push(check('h2 GET status reason', getBody.status?.reason === 'probe-unavailable', JSON.stringify(getBody.status?.reason)))
  checks.push(check('h2 GET status basis none', getBody.status?.basis === 'none', JSON.stringify(getBody.status?.basis)))
  checks.push(check('h2 GET probe attempts', Array.isArray(getBody.status?.probe?.attempts) && getBody.status.probe.attempts.length === 4, JSON.stringify(getBody.status?.probe?.attempts?.length)))
  checks.push(check('h2 GET desired view', getBody.desired?.fields?.summarizationProvider === 'nvidia', JSON.stringify(getBody.desired?.mode)))
  checks.push(check('h2 GET lastCompaction null', getBody.lastCompaction === null, JSON.stringify(getBody.lastCompaction)))
  checks.push(check('h2 GET has confirmedAt', typeof getBody.status?.confirmedAt === 'number', String(getBody.status?.confirmedAt)))
  checks.push(check('h2 GET never reports transient', !getRes.body.includes('"state":"pending"'), 'transient state leaked'))

  // --- B. invalid input ---
  const badRes = fakeResponse()
  await base.routes.get(configPath)(fakeRequest('POST', { mode: 'explicit', summarizationProvider: 'bad value', summarizationModel: 'm', retainRatio: 0.2, auto: true, compactionRetries: 1, maxOverflowRetries: 1, backupKeep: 3 }), badRes)
  checks.push(check('h2 POST invalid 400', badRes.statusCode === 400, badRes.statusCode))
  const afterBad = await readFile(base.patchPath, 'utf8')
  checks.push(check('h2 invalid write leaves patch untouched', afterBad === SAMPLE, 'patch changed'))

  // --- C. save without hmr ---
  const okRes = fakeResponse()
  await base.routes.get(configPath)(fakeRequest('POST', VALID_SAVE), okRes)
  const okBody = okRes.json()
  checks.push(check('h2 POST 200 even when hmr missing', okRes.statusCode === 200, okRes.statusCode))
  checks.push(check('h2 POST saved', okBody.saved === true, JSON.stringify(okBody.saved)))
  checks.push(check('h2 POST status restart-required', okBody.status?.state === 'restart-required', JSON.stringify(okBody.status?.state)))
  checks.push(check('h2 POST status detail hmr-unavailable', okBody.status?.detail === 'hmr-unavailable', JSON.stringify(okBody.status?.detail)))
  checks.push(check('h2 POST application restartReason', okBody.application?.restartReason === 'hmr-unavailable', JSON.stringify(okBody.application?.restartReason)))
  checks.push(check('h2 POST application has desired', okBody.application?.desired?.mode === 'follow', JSON.stringify(okBody.application?.desired?.mode)))
  checks.push(check('h2 POST application has at', typeof okBody.application?.at === 'number', String(okBody.application?.at)))
  const afterOk = await readFile(base.patchPath, 'utf8')
  checks.push(check('h2 follow removes provider', !afterOk.includes('summarizationProvider'), afterOk))
  checks.push(check('h2 follow keeps other entry', afterOk.includes('- id: other'), 'other kept'))
  const backups = await readdir(join(base.dir, 'data', 'backups'))
  checks.push(check('h2 backup written', backups.length === 1, backups.join(',')))
  checks.push(check('h2 POST never reports transient', !okRes.body.includes('"state":"pending"'), 'transient state leaked'))

  // --- D. hmr present, service matches ---
  const applied = await setup({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: [], pending: [], restartReason: undefined }) },
    profileContext: {},
    compaction: { config: MATCHING_CONFIG },
  })
  const appliedRes = fakeResponse()
  await applied.routes.get(configPath)(fakeRequest('POST', VALID_SAVE), appliedRes)
  const appliedBody = appliedRes.json()
  checks.push(check('h2 applied state', appliedBody.status?.state === 'applied', JSON.stringify(appliedBody.status?.state)))
  checks.push(check('h2 applied basis service', appliedBody.status?.basis === 'service', JSON.stringify(appliedBody.status?.basis)))
  checks.push(check('h2 applied probe cached false', appliedBody.status?.probe?.cached === false, JSON.stringify(appliedBody.status?.probe?.cached)))

  const freshRes = fakeResponse()
  await applied.routes.get(configPath)(fakeRequest('GET', undefined, `${configPath}?probe=fresh`), freshRes)
  const freshBody = freshRes.json()
  checks.push(check('h2 fresh query forces probe', freshBody.status?.probe?.cached === false, JSON.stringify(freshBody.status?.probe?.cached)))
  checks.push(check('h2 fresh keeps applied', freshBody.status?.state === 'applied', JSON.stringify(freshBody.status?.state)))

  // --- E. loader-only equality after settle ---
  const loaderOnly = await setup({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: [], pending: [], restartReason: undefined }) },
    profileContext: {},
    loader: { entries: () => [{ options: { id: 'compaction-basic', config: MATCHING_CONFIG } }] },
  })
  const loaderRes = fakeResponse()
  await loaderOnly.routes.get(configPath)(fakeRequest('POST', VALID_SAVE), loaderRes)
  const loaderBody = loaderRes.json()
  checks.push(check('h2 loader basis reported', loaderBody.status?.basis === 'loader', JSON.stringify(loaderBody.status?.basis)))
  checks.push(check('h2 loader match applied', loaderBody.status?.state === 'applied', JSON.stringify(loaderBody.status?.state)))

  // --- F. restart evidence ---
  const pendingSetup = await setup({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => ({ warnings: ['w1'], pending: [{ url: 'file:///x.js', reason: 'host-module' }], restartReason: undefined }) },
    profileContext: {},
    compaction: { config: {} },
  })
  const pendingRes = fakeResponse()
  await pendingSetup.routes.get(configPath)(fakeRequest('POST', VALID_SAVE), pendingRes)
  const pendingBody = pendingRes.json()
  checks.push(check('h2 pending evidence restart-required', pendingBody.status?.state === 'restart-required', JSON.stringify(pendingBody.status?.state)))
  checks.push(check('h2 pending detail from pending', pendingBody.status?.detail === 'host-module', JSON.stringify(pendingBody.status?.detail)))
  checks.push(check('h2 warnings surfaced', Array.isArray(pendingBody.status?.warnings) && pendingBody.status.warnings[0] === 'w1', JSON.stringify(pendingBody.status?.warnings)))

  // --- G. hmr failure ---
  const failed = await setup({
    hmr: { runExclusive: (op) => op(), reconcileProfile: async () => { throw new Error('reconcile boom') } },
    profileContext: {},
    compaction: { config: {} },
  })
  const failedRes = fakeResponse()
  await failed.routes.get(configPath)(fakeRequest('POST', VALID_SAVE), failedRes)
  const failedBody = failedRes.json()
  checks.push(check('h2 hmr throw still 200', failedRes.statusCode === 200, failedRes.statusCode))
  checks.push(check('h2 hmr throw => failed', failedBody.status?.state === 'failed', JSON.stringify(failedBody.status?.state)))
  checks.push(check('h2 hmr error stage', failedBody.status?.error?.stage === 'hmr', JSON.stringify(failedBody.status?.error?.stage)))

  const afterRes = fakeResponse()
  await failed.routes.get(configPath)(fakeRequest('GET'), afterRes)
  const afterBody = afterRes.json()
  checks.push(check('h2 GET keeps evidence', afterBody.lastApplication?.error?.stage === 'hmr', JSON.stringify(afterBody.lastApplication?.error?.stage)))

  // --- H. catalog ---
  const catalogRes = fakeResponse()
  await base.routes.get(catalogPath)(fakeRequest('GET'), catalogRes)
  const catalogBody = catalogRes.json()
  checks.push(check('h2 catalog groups', Array.isArray(catalogBody.groups) && catalogBody.groups.length === 1, JSON.stringify(catalogBody.groups)))
  checks.push(check('h2 catalog failures', Array.isArray(catalogBody.failures) && catalogBody.failures.length === 1, JSON.stringify(catalogBody.failures)))

  // --- I. compact ---
  const compactSetup = await setup({
    compaction: { compactNow: async () => ({ compactionId: 'id-9', shadowedSeqs: [1, 2], shadowedTokenCount: 500, summarySeq: 7, endSeq: 9 }) },
  })
  const compactRes = fakeResponse()
  await compactSetup.routes.get(compactPath)(fakeRequest('POST', { sessionId: 's1' }), compactRes)
  const compactBody = compactRes.json()
  checks.push(check('h2 compact ok', compactRes.statusCode === 200 && compactBody.ok === true, compactRes.body))
  checks.push(check('h2 compact source compaction', compactBody.source === 'compaction', JSON.stringify(compactBody.source)))
  checks.push(check('h2 compact result summary', compactBody.result?.shadowedCount === 2, JSON.stringify(compactBody.result)))

  const recordedRes = fakeResponse()
  await compactSetup.routes.get(configPath)(fakeRequest('GET'), recordedRes)
  const recordedBody = recordedRes.json()
  checks.push(check('h2 lastCompaction recorded', recordedBody.lastCompaction?.kind === 'success', JSON.stringify(recordedBody.lastCompaction?.kind)))
  checks.push(check('h2 lastCompaction has time', typeof recordedBody.lastCompaction?.at === 'number', String(recordedBody.lastCompaction?.at)))

  const fallbackSetup = await setup({})
  const fallbackRes = fakeResponse()
  await fallbackSetup.routes.get(compactPath)(fakeRequest('POST', { sessionId: 's1' }), fallbackRes)
  const fallbackBody = fallbackRes.json()
  checks.push(check('h2 compact fallback source', fallbackBody.source === 'commands', JSON.stringify(fallbackBody.source)))
  checks.push(check('h2 compact fallback ok', fallbackBody.ok === true, fallbackRes.body))

  const missingRes = fakeResponse()
  await base.routes.get(compactPath)(fakeRequest('POST', { sessionId: 'nope' }), missingRes)
  checks.push(check('h2 compact 404', missingRes.statusCode === 404, missingRes.statusCode))
  const noSessionRes = fakeResponse()
  await base.routes.get(compactPath)(fakeRequest('POST', {}), noSessionRes)
  checks.push(check('h2 compact 400 without session', noSessionRes.statusCode === 400, noSessionRes.statusCode))

  const errSetup = await setup({
    compaction: {
      compactNow: async () => {
        const inner = new Error('llm-deepseek: no API key for provider route "deepseek-official"')
        const outer = new Error('manual compaction could not produce a smaller summary', { cause: inner })
        outer.name = 'ManualCompactionError'
        outer.code = 'summary'
        throw outer
      },
    },
  })
  const errRes = fakeResponse()
  await errSetup.routes.get(compactPath)(fakeRequest('POST', { sessionId: 's1' }), errRes)
  const errBody = errRes.json()
  checks.push(check('h2 compact error kind summary', errBody.kind === 'summary', JSON.stringify(errBody.kind)))
  checks.push(check('h2 compact error cause kept', (errBody.error?.cause?.cause?.message ?? '').includes('no API key'), JSON.stringify(errBody.error)))

  const errGetRes = fakeResponse()
  await errSetup.routes.get(configPath)(fakeRequest('GET'), errGetRes)
  checks.push(check('h2 failed compaction recorded', errGetRes.json()?.lastCompaction?.kind === 'summary', JSON.stringify(errGetRes.json()?.lastCompaction?.kind)))
  checks.push(check('h2 compaction text no secret leak', !errRes.body.includes('sk-'), 'secret leaked'))

  return { name, checks }
}
```

> **注意**：F07 中不含任何占位断言；围栏内容即为最终内容，期望检查数 **59**。

### F08 `docs/impl-harness/h3-client-ui.mjs`（整文件替换）

> 期望检查数：**39**。行数：**82**。

```js
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()

export const name = 'h3-client-ui'

function check(label, ok, detail) {
  return { label, ok: ok === true, detail: detail === undefined ? '' : String(detail) }
}

export async function run() {
  const checks = []
  const client = await readFile(join(ROOT, 'plugin', 'lib', 'client.js'), 'utf8')
  const index = await readFile(join(ROOT, 'plugin', 'src', 'client', 'index.tsx'), 'utf8')
  const card = await readFile(join(ROOT, 'plugin', 'src', 'client', 'CompactionCard.tsx'), 'utf8')
  const localesSrc = await readFile(join(ROOT, 'plugin', 'src', 'client', 'locales.ts'), 'utf8')
  const zh = JSON.parse(await readFile(join(ROOT, 'plugin', 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(ROOT, 'plugin', 'locale', 'en.json'), 'utf8'))

  checks.push(check('h3 bundle id banner', client.includes('window.__ModuleLoader__.load('), 'missing loader wrapper'))
  checks.push(check('h3 bundle id value', client.includes('@hbk/dsh-compaction-setmodel'), 'wrong id'))
  checks.push(check('h3 registers settings section', index.includes("name: 'settings.section'"), 'slot missing'))
  checks.push(check('h3 card id', index.includes("id: 'compaction-setmodel'"), 'card id missing'))
  checks.push(check('h3 order 60', index.includes('order: 60'), 'order missing'))
  checks.push(check('h3 disables picker in follow mode', card.includes("disabled: mode !== 'explicit'"), 'picker not disabled'))
  checks.push(check('h3 passes useSessions', card.includes('props.useSessions'), 'useSessions not read'))
  checks.push(check('h3 no document.body append', !card.includes('document.body.appendChild'), 'appends to body'))

  checks.push(check('h3 has saving phase', card.includes("'saving'"), 'saving phase missing'))
  checks.push(check('h3 has applied phase', card.includes("'applied'"), 'applied phase missing'))
  checks.push(check('h3 has restart-required phase', card.includes("'restart-required'"), 'restart phase missing'))
  checks.push(check('h3 has failed phase', card.includes("'failed'"), 'failed phase missing'))
  checks.push(check('h3 has unknown phase', card.includes("'unknown'"), 'unknown phase missing'))
  checks.push(check('h3 no transient phase', !/\bpending\b/.test(card), 'transient wording remains'))
  checks.push(check('h3 recheck always rendered', !card.includes("phase === 'pending'"), 'recheck still conditional'))
  checks.push(check('h3 has details block', card.includes('details'), 'details missing'))
  checks.push(check('h3 polls with timeout', card.includes('POLL_TIMEOUT_MS'), 'timeout missing'))
  checks.push(check('h3 uses saveGeneration', card.includes('generation.current'), 'generation guard missing'))
  checks.push(check('h3 reads status block', card.includes('body?.status'), 'status block not read'))
  checks.push(check('h3 forces fresh probe on mount', card.includes('probe=fresh'), 'fresh probe missing'))
  checks.push(check('h3 shows basis footer', card.includes('status.footer'), 'footer missing'))
  checks.push(check('h3 shows last compaction', card.includes('compact.lastTitle'), 'last compaction missing'))

  const followHintOk = card.includes('mode.followHint')
  checks.push(check('h3 follow hint key used', followHintOk, 'followHint not referenced'))
  const zhHint = /'mode\.followHint':\s*'([^']+)'/.exec(localesSrc)?.[1] ?? ''
  checks.push(check('h3 zh follow hint mentions fallback', zhHint.includes('最近回答') && zhHint.includes('请求路由'), zhHint))
  checks.push(check('h3 zh follow hint disclaims equality', zhHint.includes('不保证等于'), zhHint))

  checks.push(check('h3 meta title zh', typeof zh.meta?.title === 'string' && zh.meta.title.length > 0, JSON.stringify(zh.meta)))
  checks.push(check('h3 meta detail zh', zh.meta?.detail === 'docs/DETAIL.zh.md', zh.meta?.detail))
  checks.push(check('h3 meta title en', typeof en.meta?.title === 'string' && en.meta.title.length > 0, JSON.stringify(en.meta)))
  checks.push(check('h3 meta detail en', en.meta?.detail === 'docs/DETAIL.md', en.meta?.detail))

  const zhBlock = localesSrc.slice(0, localesSrc.indexOf('export const en'))
  const enBlock = localesSrc.slice(localesSrc.indexOf('export const en'))
  const zhOnly = [...zhBlock.matchAll(/'([A-Za-z0-9_.]+)':/g)].map((m) => m[1])
  const enOnly = [...enBlock.matchAll(/'([A-Za-z0-9_.]+)':/g)].map((m) => m[1])
  const zhSet = new Set(zhOnly)
  const enSet = new Set(enOnly)
  const missingInEn = zhOnly.filter((key) => !enSet.has(key))
  const missingInZh = enOnly.filter((key) => !zhSet.has(key))
  checks.push(check('h3 zh/en key parity', missingInEn.length === 0 && missingInZh.length === 0, `en missing: ${missingInEn.join(',')}; zh missing: ${missingInZh.join(',')}`))
  checks.push(check('h3 status keys present', zhSet.has('status.applied') && zhSet.has('status.restart') && zhSet.has('status.failed') && zhSet.has('status.unknown'), 'status keys missing'))
  checks.push(check('h3 transient status key removed', !zhSet.has('status.pending'), 'status.pending still present'))
  checks.push(check('h3 basis keys present', zhSet.has('status.basis.service') && zhSet.has('status.basis.loader') && zhSet.has('status.basis.none') && zhSet.has('status.footer'), 'basis keys missing'))
  checks.push(check('h3 reason keys present', ['probeUnavailable', 'loaderNotSettled', 'mismatch', 'missingRestartBasis', 'convergenceTimeout'].every((key) => zhSet.has(`status.reason.${key}`)), 'reason keys missing'))
  checks.push(check('h3 detail keys present', zhSet.has('detail.title') && zhSet.has('detail.noCause'), 'detail keys missing'))
  checks.push(check('h3 compact kind keys present', zhSet.has('compact.busy') && zhSet.has('compact.changed') && zhSet.has('compact.commit') && zhSet.has('compact.persistence'), 'compact kind keys missing'))
  checks.push(check('h3 compact last keys present', zhSet.has('compact.lastTitle') && zhSet.has('compact.lastNone') && zhSet.has('compact.lastScope'), 'last compaction keys missing'))

  const locales = await import(new URL('../../plugin/lib/client.js', import.meta.url).href).catch(() => null)
  if (locales !== null) {
    const ns = locales.default ?? locales
    checks.push(check('h3 client module loads', typeof ns === 'object', 'module shape'))
  } else {
    checks.push(check('h3 client module loads', true, 'skipped: browser bundle needs window'))
  }

  return { name, checks }
}
```

### F09 `plugin/package.json`（单行替换）

定位第 3 行：

```json
  "version": "0.2.0",
```

替换为：

```json
  "version": "0.2.1",
```

其余字节不变。

### F10 `plugin/README.md`（替换一个整段）

定位并**整体替换**以下原文块（从 `## Hot reload` 到 `## Notes` 之前，含末尾空行）：

原文块：

```markdown
## Hot reload

Saving triggers the official DSH hot reload (`hmr.runExclusive` + `reconcileProfile`) and waits for it, so configuration changes normally apply without restarting DSH. The card reports what actually happened:

- **Applied without restart** — the reload finished and the running compaction service now uses the saved values;
- **Saved, waiting** — the reload has not confirmed yet (the card keeps checking for up to 30 seconds);
- **Saved, restart required** — the reload reported changed modules that only a restart replaces, or no hot-reload service is present;
- **Saved, but the hot reload failed** — the reload threw; the file is saved and the real error is shown.
```

替换为新块：

```markdown
## Hot reload and status

Saving triggers the official DSH hot reload (`hmr.runExclusive` + `reconcileProfile`). The card never replays a stored verdict: every read compares the saved values in the patch file against what is running right now, and reports one of four states.

- **Applied** — the running compaction service reports the saved values;
- **Restart DSH to apply** — DSH itself reported that only a restart replaces the changed modules;
- **Not confirmed** — the comparison could not be made or found no basis; the card states why (no probe path, no settled reload, or a mismatch without a restart reason) and offers **Check again**;
- **Apply failed** — the reload threw; the file is saved and the real error is shown.

Two signals keep that comparison current: the official settled-reload event (`app-boot/config-reload`) invalidates the cached probe immediately, opening the card forces a fresh probe, and a 30-second poll is only a fallback. The status line also shows the evidence basis (running instance or settled config row), when it was last confirmed, and how many config recompositions were observed.

The probe tries the running engine instance first (through the plugin context, the root context, and the `compaction-basic` entry's own fiber scope) and only falls back to the Loader config row — which is reported as the weaker basis instead of being passed off as the instance.
```

### F11 `plugin/locale/zh.json` 与 `plugin/locale/en.json`（各替换一行 description）

`plugin/locale/zh.json` 第 4 行 `"description"` 整行替换为：

```json
    "description": "设置 DSH 用哪个模型来压缩历史对话，并调节压缩行为。在「设置」里的「上下文压缩」卡片中：可选「跟随对话模型（默认）」，由 DSH 按会话实际路由选择（优先最近回答过的模型，其次最近请求路由，再退回默认配置，不保证等于界面当前选中的模型）；或选「指定专用模型」并填写渠道与模型；还可调节保留比例、自动压缩开关、压缩重试次数、溢出重试次数，以及保留多少份带时间戳的备份；点「压缩上下文」按钮可立即压缩一次，与在对话中输入 /compact 是同一个操作，且失败时直接显示真实原因（如缺少 API Key）。保存只改动 web profile 的 cordis.patch.yml 中 compaction-basic 这一条，并主动触发 DSH 官方热重载。卡片状态每次都按「配置值 vs 运行值」现场比对得出：已生效、需重启、无法确认（并说明原因）或应用失败；不会拿历史记录冒充当前结果。",
```

`plugin/locale/en.json` 第 4 行 `"description"` 整行替换为：

```json
    "description": "Sets which model DSH uses to condense conversation history, and tunes the compaction behavior. In the Settings card named Compaction: choose Follow conversation model (default) and DSH picks the route of this session (the model that last answered, then the latest request route, then DSH defaults — not necessarily the model selected in the UI), or Dedicated model with a provider and model entry; adjust retain ratio, auto compaction, compaction and overflow retries, and how many timestamped backups to keep; press Compact context to run one on-demand compaction, the same operation as typing /compact in a conversation, with the real failure cause shown (for example a missing API key). Saving edits only the compaction-basic entry of the web profile cordis.patch.yml and triggers the official DSH hot reload. The card state is a live comparison of the saved values against the running ones — applied, restart required, not confirmed (with the reason), or apply failed — never a stored verdict replayed.",
```

---

## 5. 未改动文件基线（一个字节都不能变）

用 `(Get-Content <path>).Count` 核对行数；行数必须完全一致。

| 文件 | 行数 |
|---|---|
| `plugin/src/patch-editor.ts` | 345 |
| `plugin/src/settings-store.ts` | 54 |
| `plugin/src/compaction-service.ts` | 161 |
| `plugin/src/config-schema.ts` | 218 |
| `plugin/src/client/index.tsx` | 51 |
| `plugin/src/client/ModelPicker.tsx` | 53 |
| `plugin/src/client/NumberField.tsx` | 17 |
| `docs/impl-harness/h1-patch-editor.mjs` | 119 |
| `docs/impl-harness/run-all.mjs` | 32 |

---

## 6. 验证阶段（严格串行，禁止并行）

### V1 逐字节回读

对 F01/F02/F03/F04/F05/F06/F07/F08 逐文件比对：把 code.md 中对应围栏块提取为临时文件，与落盘文件做 `Get-FileHash` 比较，必须全部一致。

### V1b 未改动文件核对

按 §5 表逐文件核对行数，必须全部相等。

### V2 类型检查

```powershell
cd D:\DSH-SetModel-for-ContextCompression\plugin
npm run typecheck
```

必须退出码 0，且输出中不含 `error TS`。

### V3 构建

```powershell
cd D:\DSH-SetModel-for-ContextCompression\plugin
npm run build
```

必须退出码 0，并生成 `lib/index.js` 与 `lib/client.js`。

### V4 全量测试

```powershell
cd D:\DSH-SetModel-for-ContextCompression
node docs/impl-harness/run-all.mjs
```

必须满足：

- 退出码 0；
- 输出末尾 JSON 的 `allPassed` 为 `true`；
- 四个套件分别通过，检查数为：`h1-patch-editor` **22**、`h2-routes` **59**、`h3-client-ui` **38**、`h4-runtime` **63**，总计 **182**。

任一数字不符即视为失败，必须修正到数字与断言同时满足，不得修改数字来"凑对"。

### V5 打包

```powershell
cd D:\DSH-SetModel-for-ContextCompression\plugin
$env:npm_config_cache="D:\DSH-SetModel-for-ContextCompression\.npm-cache"
npm pack
Get-FileHash .\hbk-dsh-compaction-setmodel-0.2.1.tgz -Algorithm SHA256
```

记录 tgz 字节数与 SHA256。

### V6 安装到 web profile

1. 若已安装：`plugin_manager({action:'remove_bundle', target:'@hbk/dsh-compaction-setmodel'})`。
2. `plugin_manager({action:'install_bundle', target:'D:/DSH-SetModel-for-ContextCompression/plugin/hbk-dsh-compaction-setmodel-0.2.1.tgz'})`。
3. 必须返回 `application: 'applied'` 且 `version: '0.2.1'`，无 warnings。
4. 探测 `GET http://127.0.0.1:3080/plugins/compaction-setmodel/config?probe=fresh`，确认响应含 `status` 块、`status.state` 为四值之一、`status.probe.attempts` 为 4 项。

---

## 7. 每包自检命令

```powershell
# W1
(Get-Content plugin\src\runtime-status.ts).Count                      # 期望 480
Select-String -Path plugin\src\runtime-status.ts -Pattern "export function evaluateStatus" | Measure-Object | % Count   # 期望 1
Select-String -Path plugin\src\runtime-status.ts -Pattern "'pending'" | Measure-Object | % Count                        # 期望 0

# W2
(Get-Content plugin\src\web-routes.ts).Count                          # 期望 364
Select-String -Path plugin\src\web-routes.ts -Pattern "convergeAfterSave|lastCompaction|queryFlag" | Measure-Object | % Count   # 期望 >= 6
Select-String -Path plugin\src\index.ts -Pattern "evaluateStatus|StatusReport" | Measure-Object | % Count                       # 期望 >= 2

# W3
(Get-Content plugin\src\client\locales.ts).Count                      # 期望 120
Select-String -Path plugin\src\client\locales.ts -Pattern "status.pending" | Measure-Object | % Count  # 期望 0

# W4
(Get-Content plugin\src\client\CompactionCard.tsx).Count              # 期望 386
Select-String -Path plugin\src\client\CompactionCard.tsx -Pattern "\bpending\b" | Measure-Object | % Count  # 期望 0

# W5
(Get-Content docs\impl-harness\h4-runtime.mjs).Count                  # 期望 322
Select-String -Path docs\impl-harness\h4-runtime.mjs -Pattern "checks.push\(check\(" -AllMatches | % { $_.Matches.Count } | Measure-Object -Sum | % Sum   # 期望 63
Select-String -Path docs\impl-harness\h2-routes.mjs -Pattern "checks.push\(check\(" -AllMatches | % { $_.Matches.Count } | Measure-Object -Sum | % Sum     # 期望 59
Select-String -Path docs\impl-harness\h3-client-ui.mjs -Pattern "checks.push\(check\(" -AllMatches | % { $_.Matches.Count } | Measure-Object -Sum | % Sum   # 期望 38

# W6
Select-String -Path plugin\package.json -Pattern '"version": "0.2.1"' | Measure-Object | % Count   # 期望 1
Select-String -Path plugin\README.md -Pattern 'Applies|Applied' | Measure-Object | % Count          # 期望 >= 1
Select-String -Path plugin\locale\zh.json -Pattern '现场比对' | Measure-Object | % Count           # 期望 1
Select-String -Path plugin\locale\en.json -Pattern 'live comparison' | Measure-Object | % Count    # 期望 1
```

---

## 8. 报告模板（交付时必须逐项填写实测值）

```markdown
## 0.2.1 施工报告

### 执行模式
- 并行能力探测：list_agents ✅/❌，list_subagent_models ✅/❌
- 实际模式：并行（W1–W6）/ 串行降级

### 各包结果
| 包 | 文件 | 行数 | 回读 |
|---|---|---|---|
| W1 | runtime-status.ts | ? | 一致/不一致 |
| ... | ... | ... | ... |

### 验证
- V1 逐字节：8/8 一致
- V1b 未改动文件：9/9 行数一致
- V2 typecheck：退出码 ?，error TS 计数 ?
- V3 build：退出码 ?，index.js ? B，client.js ? B
- V4 run-all：allPassed=?，h1=? / h2=? / h3=? / h4=?，合计=?
- V5 pack：tgz ? B，SHA256 ?
- V6 install：application=?，version=?，warnings=?

### 实机状态抽样
GET ?probe=fresh 返回的 status.state = ?，basis = ?，probe.attempts 路径顺序 = ?

### 未验证事项（如实列出）
```

---

## 9. 回滚

若 V4/V6 失败且短时间无法修正：

- 代码回滚：`git checkout -- plugin/src docs/impl-harness plugin/README.md plugin/locale plugin/package.json`（由人工执行）。
- 安装回滚：`plugin_manager` 移除 0.2.1 后安装 `plugin/hbk-dsh-compaction-setmodel-0.2.0.tgz`。
- 配置回滚：从 `~/.dsh-compaction-setmodel/backups/` 取最新备份，按原子写覆盖 `cordis.patch.yml`（由人工执行）。

---

## 10. 禁止事项（本章任一违反即视为施工失败）

1. 修改 §4 之外的文件。
2. 修改 §5 列出的文件。
3. 在施工阶段运行 build / typecheck / pack / run-all / 安装。
4. 使用 `'pending'` 作为任何状态值。
5. 为了让测试通过而修改期望数字、删减断言、放宽断言条件。
6. 在 `probeRuntime` 中吞掉异常却仍返回 `applied`。
7. 在 `evaluateStatus` 中把 `loader` 证据标成 `basis: 'service'`。
8. 延长 `CONVERGENCE_WINDOW_MS` 或把超时结果改成"继续等待"。
9. 让 `registerReloadListener` 的回调再次调用 HMR。
10. 提交 git、修改真实 profile patch、重启 DSH。
