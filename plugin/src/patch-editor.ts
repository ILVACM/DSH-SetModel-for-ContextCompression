export const TARGET_FIELDS = [
  'summarizationProvider',
  'summarizationModel',
  'retainRatio',
  'auto',
  'compactionRetries',
  'maxOverflowRetries',
] as const

export type TargetField = typeof TARGET_FIELDS[number]
export type FieldValue = string | number | boolean
export type CompactionFields = Record<TargetField, FieldValue | null>
export type CompactionMode = 'follow' | 'explicit'
export type PatchOperation =
  | { op: 'set'; field: TargetField; value: FieldValue }
  | { op: 'delete'; field: TargetField }
export interface PatchChange {
  op: 'set' | 'insert' | 'delete'
  field: TargetField
  lineBefore: string | null
  lineAfter: string | null
}
export interface PatchReadResult {
  entryFound: boolean
  mode: CompactionMode
  fields: CompactionFields
}
export interface PatchEditResult extends PatchReadResult {
  text: string
  changes: PatchChange[]
}
interface PatchLine {
  content: string
  eol: string
}
interface EntryLocation {
  start: number
  end: number
  indent: number
  configIndex: number
  configEnd: number
  configIndent: number
  childIndent: number
}

const ENTRY_ID = 'compaction-basic'
const ENTRY_NAME = '@deepseek-ai/dsh-compaction-basic'
const TARGET_SET = new Set<string>(TARGET_FIELDS)

function splitLines(text: string): PatchLine[] {
  const lines: PatchLine[] = []
  let offset = 0
  while (offset < text.length) {
    const rest = text.slice(offset)
    const match = /\r\n|\n|\r/.exec(rest)
    if (match === null || match.index === undefined) {
      lines.push({ content: rest, eol: '' })
      break
    }
    const end = offset + match.index
    lines.push({ content: text.slice(offset, end), eol: match[0] })
    offset = end + match[0].length
  }
  return lines
}

function joinLines(lines: PatchLine[]): string {
  return lines.map((line) => line.content + line.eol).join('')
}

function indentation(content: string): number {
  return (/^[ \t]*/.exec(content) ?? [''])[0].length
}

function isBlankOrComment(content: string): boolean {
  const trimmed = content.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function locateEntry(lines: PatchLine[]): EntryLocation | null {
  const starts: number[] = []
  const pattern = /^\s*-\s*id\s*:\s*['"]?compaction-basic['"]?\s*(?:#.*)?$/
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index].content)) starts.push(index)
  }
  if (starts.length > 1) {
    throw new Error(`duplicate compaction-basic entries at lines ${starts.map((n) => n + 1).join(', ')}`)
  }
  if (starts.length === 0) return null
  const start = starts[0]
  const indent = indentation(lines[start].content)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const content = lines[index].content
    if (/^\s*-\s/.test(content) && indentation(content) <= indent) {
      end = index
      break
    }
  }
  const configIndexes: number[] = []
  const configPattern = /^(\s*)config\s*:\s*(?:\{\s*\})?\s*(?:#.*)?$/
  for (let index = start + 1; index < end; index += 1) {
    if (configPattern.test(lines[index].content)) configIndexes.push(index)
  }
  if (configIndexes.length > 1) {
    throw new Error(`duplicate config blocks in compaction-basic at lines ${configIndexes.map((n) => n + 1).join(', ')}`)
  }
  const configIndex = configIndexes.length === 0 ? -1 : configIndexes[0]
  if (configIndex < 0) {
    for (let index = start + 1; index < end; index += 1) {
      if (/^[ \t]*config[ \t]*:/.test(lines[index].content)) {
        throw new Error(`unsupported inline config at line ${index + 1}; use a block config`)
      }
    }
    return { start, end, indent, configIndex, configEnd: end, configIndent: -1, childIndent: indent + 4 }
  }
  const configIndent = indentation(lines[configIndex].content)
  let configEnd = end
  let childIndent = configIndent + 2
  let foundChild = false
  for (let index = configIndex + 1; index < end; index += 1) {
    const content = lines[index].content
    if (isBlankOrComment(content)) continue
    const currentIndent = indentation(content)
    if (currentIndent <= configIndent) {
      configEnd = index
      break
    }
    if (!foundChild) {
      childIndent = currentIndent
      foundChild = true
    }
  }
  return { start, end, indent, configIndex, configEnd, configIndent, childIndent }
}

function stripInlineComment(raw: string): string {
  let single = false
  let double = false
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char === "'" && !double) {
      if (single && raw[index + 1] === "'") index += 1
      else single = !single
    } else if (char === '"' && !single && raw[index - 1] !== '\\') {
      double = !double
    } else if (char === '#' && !single && !double && (index === 0 || /\s/.test(raw[index - 1]))) {
      return raw.slice(0, index).trim()
    }
  }
  return raw.trim()
}

function parseScalar(rawInput: string): FieldValue | null {
  const raw = stripInlineComment(rawInput)
  if (raw === '' || raw === 'null' || raw === 'Null' || raw === 'NULL' || raw === '~') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'") || raw.length < 2) throw new Error(`unterminated single-quoted scalar: ${raw}`)
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  if (raw.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'string') throw new Error('not a string')
      return parsed
    } catch {
      throw new Error(`unsupported double-quoted scalar: ${raw}`)
    }
  }
  return raw
}

function readFields(lines: PatchLine[], location: EntryLocation | null): CompactionFields {
  const fields = Object.fromEntries(TARGET_FIELDS.map((field) => [field, null])) as CompactionFields
  if (location === null || location.configIndex < 0) return fields
  for (let index = location.configIndex + 1; index < location.configEnd; index += 1) {
    const content = lines[index].content
    if (isBlankOrComment(content) || indentation(content) !== location.childIndent) continue
    const match = /^[ \t]*([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(content)
    if (match === null || !TARGET_SET.has(match[1])) continue
    const field = match[1] as TargetField
    if (fields[field] !== null) throw new Error(`duplicate ${field} at line ${index + 1}`)
    fields[field] = parseScalar(match[2])
  }
  return fields
}

function modeOf(fields: CompactionFields): CompactionMode {
  const provider = fields.summarizationProvider
  const model = fields.summarizationModel
  return (provider === null || provider === '') && (model === null || model === '') ? 'follow' : 'explicit'
}

export function readCompactionPatch(text: string): PatchReadResult {
  const lines = splitLines(text)
  const location = locateEntry(lines)
  const fields = readFields(lines, location)
  return { entryFound: location !== null, mode: modeOf(fields), fields }
}

function serializeValue(value: FieldValue): string {
  if (typeof value === 'string') {
    if (!/^[A-Za-z0-9_@./-]{1,128}$/.test(value)) {
      throw new Error(`unsafe string value for patch output: ${JSON.stringify(value)}`)
    }
    return value
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite numeric value')
  return String(value)
}

function defaultEol(lines: PatchLine[]): string {
  return lines.find((line) => line.eol !== '')?.eol ?? '\n'
}

function fieldLine(field: TargetField, value: FieldValue, indent: number, eol: string): PatchLine {
  return { content: `${' '.repeat(indent)}${field}: ${serializeValue(value)}`, eol }
}

function ensurePreviousEol(lines: PatchLine[], index: number, eol: string): void {
  if (index > 0 && lines[index - 1].eol === '') lines[index - 1].eol = eol
}

export function editCompactionPatch(text: string, operations: PatchOperation[]): PatchEditResult {
  const seen = new Set<string>()
  for (const operation of operations) {
    if (!TARGET_SET.has(operation.field)) throw new Error(`unknown target field: ${operation.field}`)
    if (seen.has(operation.field)) throw new Error(`duplicate operation for ${operation.field}`)
    seen.add(operation.field)
    if (operation.op === 'set') serializeValue(operation.value)
  }
  const original = readCompactionPatch(text)
  if (operations.length === 0) return { ...original, text, changes: [] }
  const lines = splitLines(text)
  const eol = defaultEol(lines)
  const changes: PatchChange[] = []
  let location = locateEntry(lines)
  if (location === null) {
    const sets = operations.filter((operation) => operation.op === 'set')
    if (sets.length === 0) return { ...original, text, changes: [] }
    ensurePreviousEol(lines, lines.length, eol)
    lines.push(
      { content: `- id: ${ENTRY_ID}`, eol },
      { content: `  name: '${ENTRY_NAME}'`, eol },
      { content: '  config:', eol },
    )
    for (const operation of sets) {
      if (operation.op !== 'set') continue
      const line = fieldLine(operation.field, operation.value, 4, eol)
      lines.push(line)
      changes.push({ op: 'insert', field: operation.field, lineBefore: null, lineAfter: line.content })
    }
    const result = readCompactionPatch(joinLines(lines))
    return { ...result, text: joinLines(lines), changes }
  }

  for (const operation of operations) {
    const target = location
    if (operation.op !== 'delete' || target === null || target.configIndex < 0) continue
    for (let index = target.configIndex + 1; index < target.configEnd; index += 1) {
      const content = lines[index].content
      const match = /^[ \t]*([A-Za-z][A-Za-z0-9]*)\s*:/.exec(content)
      if (match?.[1] !== operation.field || indentation(content) !== target.childIndent) continue
      changes.push({ op: 'delete', field: operation.field, lineBefore: content, lineAfter: null })
      lines.splice(index, 1)
      location = locateEntry(lines)
      break
    }
  }

  location = locateEntry(lines)
  if (location === null) throw new Error('compaction-basic entry disappeared during editing')
  const sets = operations.filter((operation) => operation.op === 'set')
  if (sets.length > 0 && location.configIndex < 0) {
    const insertAt = location.end
    ensurePreviousEol(lines, insertAt, eol)
    lines.splice(insertAt, 0, { content: `${' '.repeat(location.indent + 2)}config:`, eol })
    location = locateEntry(lines)
    if (location === null || location.configIndex < 0) throw new Error('failed to create config block')
  }

  if (sets.length > 0 && location !== null && location.configIndex >= 0) {
    const configContent = lines[location.configIndex].content
    if (/\{\s*\}/.test(configContent)) {
      lines[location.configIndex].content = configContent.replace(/\{\s*\}/, '').trimEnd()
      location = locateEntry(lines)
    }
  }

  for (const operation of sets) {
    if (operation.op !== 'set' || location === null) continue
    let found = -1
    for (let index = location.configIndex + 1; index < location.configEnd; index += 1) {
      const content = lines[index].content
      const match = /^[ \t]*([A-Za-z][A-Za-z0-9]*)\s*:/.exec(content)
      if (match?.[1] === operation.field && indentation(content) === location.childIndent) {
        found = index
        break
      }
    }
    if (found >= 0) {
      const before = lines[found].content
      const after = `${' '.repeat(location.childIndent)}${operation.field}: ${serializeValue(operation.value)}`
      if (before !== after) {
        lines[found].content = after
        changes.push({ op: 'set', field: operation.field, lineBefore: before, lineAfter: after })
      }
    }
    location = locateEntry(lines)
  }

  const missing = sets.filter((operation) => {
    if (operation.op !== 'set' || location === null) return false
    for (let index = location.configIndex + 1; index < location.configEnd; index += 1) {
      const content = lines[index].content
      const match = /^[ \t]*([A-Za-z][A-Za-z0-9]*)\s*:/.exec(content)
      if (match?.[1] === operation.field && indentation(content) === location.childIndent) return false
    }
    return true
  })
  if (missing.length > 0 && location !== null) {
    const targetLocation = location
    let insertAt = targetLocation.configIndex + 1
    for (let index = targetLocation.configIndex + 1; index < targetLocation.configEnd; index += 1) {
      const content = lines[index].content
      if (!isBlankOrComment(content) && indentation(content) === targetLocation.childIndent) insertAt = index + 1
    }
    ensurePreviousEol(lines, insertAt, eol)
    const additions = missing.map((operation) => {
      if (operation.op !== 'set') throw new Error('unexpected delete operation')
      return fieldLine(operation.field, operation.value, targetLocation.childIndent, eol)
    })
    lines.splice(insertAt, 0, ...additions)
    for (let index = 0; index < additions.length; index += 1) {
      const operation = missing[index]
      changes.push({ op: 'insert', field: operation.field, lineBefore: null, lineAfter: additions[index].content })
    }
  }
  const output = joinLines(lines)
  const result = readCompactionPatch(output)
  return { ...result, text: output, changes }
}
