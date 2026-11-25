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
