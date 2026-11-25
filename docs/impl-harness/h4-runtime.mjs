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
