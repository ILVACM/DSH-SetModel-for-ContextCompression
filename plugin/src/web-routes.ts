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
