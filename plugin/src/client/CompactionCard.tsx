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
