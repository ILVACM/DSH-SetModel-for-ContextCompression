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
