import {
  TARGET_FIELDS,
  type CompactionFields,
  type CompactionMode,
  type FieldValue,
  type PatchOperation,
  type TargetField,
} from './patch-editor.ts'

export interface CompactionView {
  mode: CompactionMode
  fields: CompactionFields
}
export interface CompactionValues extends CompactionView {
  backupKeep: number
}
/** A normalized view plus the fields whose comparison is not meaningful. */
export interface CanonicalView {
  view: CompactionView
  unknown: TargetField[]
}

export const DEFAULT_FIELDS: CompactionFields = {
  summarizationProvider: null,
  summarizationModel: null,
  retainRatio: 0.16,
  auto: true,
  compactionRetries: 1,
  maxOverflowRetries: 1,
}

export class ValidationFailure extends Error {
  readonly errors: Record<string, string>

  constructor(errors: Record<string, string>) {
    super('invalid compaction settings')
    this.name = 'ValidationFailure'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Trimmed non-empty string, otherwise null. Undefined, null and '' all mean "not set". */
function routeValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

export function fieldsFromConfig(config: unknown): CompactionFields {
  const source = isRecord(config) ? config : {}
  return Object.fromEntries(TARGET_FIELDS.map((field) => {
    const value: unknown = source[field]
    const valid = typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
    return [field, valid ? value as FieldValue : null]
  })) as CompactionFields
}

export function withDefaults(fields: CompactionFields): CompactionFields {
  return Object.fromEntries(TARGET_FIELDS.map((field) => [
    field,
    fields[field] === null ? DEFAULT_FIELDS[field] : fields[field],
  ])) as CompactionFields
}

export function modeOfFields(fields: CompactionFields): CompactionMode {
  const provider = fields.summarizationProvider
  const model = fields.summarizationModel
  return (provider === null || provider === '') && (model === null || model === '') ? 'follow' : 'explicit'
}

/** Normalize a live or persisted config so equal meaning compares equal. */
export function canonicalFromConfig(config: unknown): CanonicalView {
  const source = isRecord(config) ? config : {}
  const provider = routeValue(source.summarizationProvider)
  const model = routeValue(source.summarizationModel)
  const unknown: TargetField[] = []
  const fields: CompactionFields = {
    summarizationProvider: provider,
    summarizationModel: model,
    retainRatio: 0.16,
    auto: true,
    compactionRetries: 1,
    maxOverflowRetries: 1,
  }
  const ratio = source.retainRatio
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    fields.retainRatio = ratio
  } else {
    const retainTokens = source.retainTokens
    // DSH accepts retainTokens instead of retainRatio; a missing ratio then carries no
    // comparison meaning, so it must never be filled with the default value.
    if (typeof retainTokens === 'number' && Number.isFinite(retainTokens)) unknown.push('retainRatio')
  }
  fields.auto = typeof source.auto === 'boolean' ? source.auto : true
  fields.compactionRetries = integerOr(source.compactionRetries, 1)
  fields.maxOverflowRetries = integerOr(source.maxOverflowRetries, 1)
  const mode: CompactionMode = provider === null && model === null ? 'follow' : 'explicit'
  return { view: { mode, fields }, unknown }
}

/** Normalize an already-validated form value. */
export function canonicalFromView(view: CompactionView): CanonicalView {
  const provider = routeValue(view.fields.summarizationProvider)
  const model = routeValue(view.fields.summarizationModel)
  const fields: CompactionFields = {
    summarizationProvider: provider,
    summarizationModel: model,
    retainRatio: typeof view.fields.retainRatio === 'number' ? view.fields.retainRatio : 0.16,
    auto: typeof view.fields.auto === 'boolean' ? view.fields.auto : true,
    compactionRetries: integerOr(view.fields.compactionRetries, 1),
    maxOverflowRetries: integerOr(view.fields.maxOverflowRetries, 1),
  }
  const mode: CompactionMode = provider === null && model === null ? 'follow' : 'explicit'
  return { view: { mode, fields }, unknown: [] }
}

/** Compare two canonical views, skipping fields that carry no comparison meaning. */
export function sameCanonical(left: CanonicalView | null, right: CanonicalView | null): boolean {
  if (left === null || right === null) return false
  if (left.view.mode !== right.view.mode) return false
  const skip = new Set<TargetField>([...left.unknown, ...right.unknown])
  return TARGET_FIELDS.every((field) => skip.has(field) || left.view.fields[field] === right.view.fields[field])
}

export function sameView(left: CompactionView | null, right: CompactionView | null): boolean {
  return sameCanonical(
    left === null ? null : { view: left, unknown: [] },
    right === null ? null : { view: right, unknown: [] },
  )
}

function validRouteText(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_@./-]{1,128}$/.test(value)
}

function numberValue(value: unknown, field: string, errors: Record<string, string>): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors[field] = '必须是有限数字'
    return 0
  }
  return value
}

export function normalizeCompactionInput(body: unknown): CompactionValues {
  if (!isRecord(body)) throw new ValidationFailure({ body: '请求体必须是 JSON 对象' })
  const errors: Record<string, string> = {}
  const mode = body.mode
  if (mode !== 'follow' && mode !== 'explicit') errors.mode = 'mode 必须是 follow 或 explicit'
  let provider: string | null = null
  let model: string | null = null
  if (mode === 'explicit') {
    if (!validRouteText(body.summarizationProvider)) {
      errors.summarizationProvider = '渠道仅允许字母、数字、_、@、.、/、-，长度 1–128'
    } else provider = body.summarizationProvider
    if (!validRouteText(body.summarizationModel)) {
      errors.summarizationModel = '模型仅允许字母、数字、_、@、.、/、-，长度 1–128'
    } else model = body.summarizationModel
  }
  const retainRatio = numberValue(body.retainRatio, 'retainRatio', errors)
  if (!errors.retainRatio && (retainRatio <= 0 || retainRatio >= 0.8 || Number(retainRatio.toFixed(2)) !== retainRatio)) {
    errors.retainRatio = '保留比例须大于 0、小于 0.8，且最多两位小数'
  }
  if (typeof body.auto !== 'boolean') errors.auto = 'auto 必须是布尔值'
  const compactionRetries = numberValue(body.compactionRetries, 'compactionRetries', errors)
  if (!errors.compactionRetries && (!Number.isInteger(compactionRetries) || compactionRetries < 0 || compactionRetries > 9)) {
    errors.compactionRetries = '压缩重试必须是 0–9 的整数'
  }
  const maxOverflowRetries = numberValue(body.maxOverflowRetries, 'maxOverflowRetries', errors)
  if (!errors.maxOverflowRetries && (!Number.isInteger(maxOverflowRetries) || maxOverflowRetries < 0 || maxOverflowRetries > 9)) {
    errors.maxOverflowRetries = '溢出重试必须是 0–9 的整数'
  }
  const backupKeep = numberValue(body.backupKeep, 'backupKeep', errors)
  if (!errors.backupKeep && (!Number.isInteger(backupKeep) || backupKeep < 1 || backupKeep > 50)) {
    errors.backupKeep = '备份份数必须是 1–50 的整数'
  }
  if (Object.keys(errors).length > 0) throw new ValidationFailure(errors)
  return {
    mode: mode as CompactionMode,
    fields: {
      summarizationProvider: provider,
      summarizationModel: model,
      retainRatio,
      auto: body.auto as boolean,
      compactionRetries,
      maxOverflowRetries,
    },
    backupKeep,
  }
}

export function toPatchOperations(values: CompactionValues): PatchOperation[] {
  const operations: PatchOperation[] = values.mode === 'follow'
    ? [
        { op: 'delete', field: 'summarizationProvider' },
        { op: 'delete', field: 'summarizationModel' },
      ]
    : [
        { op: 'set', field: 'summarizationProvider', value: values.fields.summarizationProvider as string },
        { op: 'set', field: 'summarizationModel', value: values.fields.summarizationModel as string },
      ]
  for (const field of ['retainRatio', 'auto', 'compactionRetries', 'maxOverflowRetries'] as const) {
    operations.push({ op: 'set', field, value: values.fields[field] as FieldValue })
  }
  return operations
}

export function viewOf(values: CompactionValues): CompactionView {
  return { mode: values.mode, fields: { ...values.fields } }
}
