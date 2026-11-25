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
