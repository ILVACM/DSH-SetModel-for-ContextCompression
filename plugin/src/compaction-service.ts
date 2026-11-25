import { sanitizeText, toPublicCause, type PublicError } from './runtime-status.ts'

export type CompactKind =
  | 'success'
  | 'empty'
  | 'busy'
  | 'cancelled'
  | 'changed'
  | 'summary'
  | 'commit'
  | 'persistence'
  | 'error'

export interface CompactResultSummary {
  compactionId: string
  shadowedCount: number
  shadowedTokenCount: number
  summarySeq: number
  endSeq: number
}

export interface CompactOutcome {
  ok: boolean
  kind: CompactKind
  text: string
  source: 'compaction' | 'commands'
  result: CompactResultSummary | null
  error: PublicError | null
}

const MANUAL_CODES: readonly string[] = ['busy', 'cancelled', 'changed', 'summary', 'commit', 'persistence']

const KIND_TEXT: Record<string, string> = {
  success: '压缩完成',
  empty: '暂无可压缩历史',
  busy: '当前会话正忙，请稍后再试',
  cancelled: '压缩已取消',
  changed: '历史在压缩期间发生变化，请重试',
  summary: '压缩失败：摘要阶段未完成',
  commit: '压缩提交未干净完成，请先检查会话状态',
  persistence: '压缩完成但会话保存失败',
  error: '压缩失败',
}

function serviceOf(ctx: any, name: string): any {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) ?? null : null
  } catch {
    return null
  }
}

function manualCode(error: unknown): CompactKind | null {
  if (error === null || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  if (record.name !== 'ManualCompactionError') return null
  const code = record.code
  return typeof code === 'string' && MANUAL_CODES.includes(code) ? (code as CompactKind) : null
}

function summarize(result: any): CompactResultSummary {
  return {
    compactionId: typeof result?.compactionId === 'string' ? result.compactionId : String(result?.compactionId ?? ''),
    shadowedCount: Array.isArray(result?.shadowedSeqs) ? result.shadowedSeqs.length : 0,
    shadowedTokenCount: typeof result?.shadowedTokenCount === 'number' ? result.shadowedTokenCount : 0,
    summarySeq: typeof result?.summarySeq === 'number' ? result.summarySeq : 0,
    endSeq: typeof result?.endSeq === 'number' ? result.endSeq : 0,
  }
}

async function runViaCommands(ctx: any, agent: any, signal: AbortSignal): Promise<CompactOutcome> {
  const commands = serviceOf(ctx, 'commands')
  if (commands === null || typeof commands.execute !== 'function') {
    return {
      ok: false,
      kind: 'error',
      text: '压缩服务不可用',
      source: 'commands',
      result: null,
      error: { stage: 'compact', code: 'unavailable', message: 'compaction 与 commands 服务均不可用', detailAvailable: false },
    }
  }
  try {
    const raw = await commands.execute(agent, '/compact', [], signal)
    const value = raw?.result
    const success = value?.kind === 'success'
    const text = typeof value?.text === 'string' && value.text !== '' ? value.text : KIND_TEXT[success ? 'success' : 'error']
    return {
      ok: success,
      kind: success ? 'success' : 'error',
      text,
      source: 'commands',
      result: null,
      error: success ? null : {
        stage: 'compact',
        code: 'commands',
        message: `命令通道仅返回通用结果：${sanitizeText(text, 300)}`,
        detailAvailable: false,
      },
    }
  } catch (error: unknown) {
    return {
      ok: false,
      kind: 'error',
      text: KIND_TEXT.error,
      source: 'commands',
      result: null,
      error: {
        stage: 'compact',
        code: 'error',
        message: sanitizeText((error as { message?: unknown } | null)?.message ?? error),
        detailAvailable: false,
      },
    }
  }
}

/**
 * Run one on-demand compaction. The direct service path keeps the backend's real failure
 * cause, which the /compact command adapter folds into one generic message.
 */
export async function runCompaction(ctx: any, agent: any, signal: AbortSignal): Promise<CompactOutcome> {
  const compaction = serviceOf(ctx, 'compaction')
  if (compaction !== null && typeof compaction.compactNow === 'function') {
    try {
      const raw = await compaction.compactNow(agent, signal)
      if (raw === null || raw === undefined) {
        return { ok: true, kind: 'empty', text: KIND_TEXT.empty, source: 'compaction', result: null, error: null }
      }
      const result = summarize(raw)
      return {
        ok: true,
        kind: 'success',
        text: `已压缩 ${result.shadowedCount} 项历史（约 ${result.shadowedTokenCount} tokens）`,
        source: 'compaction',
        result,
        error: null,
      }
    } catch (error: unknown) {
      const kind = manualCode(error)
      const cause = toPublicCause(error)
      const detail = cause?.cause?.message ?? cause?.message ?? ''
      const headline = KIND_TEXT[kind ?? 'error']
      return {
        ok: false,
        kind: kind ?? 'error',
        text: detail === '' ? headline : `${headline}：${sanitizeText(detail, 300)}`,
        source: 'compaction',
        result: null,
        error: {
          stage: 'compact',
          code: kind ?? 'error',
          message: sanitizeText((error as { message?: unknown } | null)?.message ?? error),
          ...cause === undefined ? {} : { cause },
          detailAvailable: true,
        },
      }
    }
  }
  return runViaCommands(ctx, agent, signal)
}
