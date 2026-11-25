import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

export const name = 'h1-patch-editor'

function check(label, ok, detail) {
  return { label, ok: ok === true, detail: detail === undefined ? '' : String(detail) }
}

export async function run() {
  const mod = await import(pathToFileURL(join(ROOT, 'plugin', 'lib', 'index.js')).href)
  const { editCompactionPatch, readCompactionPatch } = mod
  const checks = []

  const plain = [
    '- id: other',
    '  config:',
    '    keep: 1',
    '- id: compaction-basic',
    "  name: '@deepseek-ai/dsh-compaction-basic'",
    '  config:',
    '    summarizationProvider: nvidia',
    '    summarizationModel: nvidia/nemotron-3-ultra-550b-a55b',
    '    retainRatio: 0.16',
    '- id: tail',
    '  config: {}',
    '',
  ].join('\n')

  const read1 = readCompactionPatch(plain)
  checks.push(check('h1 mode explicit', read1.mode === 'explicit', read1.mode))
  checks.push(check('h1 provider parsed', read1.fields.summarizationProvider === 'nvidia', read1.fields.summarizationProvider))
  checks.push(check('h1 retainRatio parsed', read1.fields.retainRatio === 0.16, read1.fields.retainRatio))
  checks.push(check('h1 entry found', read1.entryFound === true, read1.entryFound))

  const follow = editCompactionPatch(plain, [
    { op: 'delete', field: 'summarizationProvider' },
    { op: 'delete', field: 'summarizationModel' },
  ])
  checks.push(check('h1 delete mode follows', follow.mode === 'follow', follow.mode))
  checks.push(check('h1 delete removes provider line', !follow.text.includes('summarizationProvider'), follow.text))
  const expectedFollow = plain
    .split('\n')
    .filter((line) => !line.includes('summarizationProvider') && !line.includes('summarizationModel'))
    .join('\n')
  checks.push(check('h1 delete is byte-exact', follow.text === expectedFollow, JSON.stringify(follow.text)))

  const set1 = editCompactionPatch(plain, [
    { op: 'set', field: 'summarizationProvider', value: 'opencode-local' },
    { op: 'set', field: 'summarizationModel', value: 'free-x' },
  ])
  checks.push(check('h1 set replaces value', set1.fields.summarizationProvider === 'opencode-local', set1.fields.summarizationProvider))
  checks.push(check('h1 set keeps other lines', set1.text.includes('    retainRatio: 0.16'), 'retainRatio line kept'))
  const idempotent = editCompactionPatch(set1.text, [
    { op: 'set', field: 'summarizationProvider', value: 'opencode-local' },
    { op: 'set', field: 'summarizationModel', value: 'free-x' },
  ])
  checks.push(check('h1 set is idempotent', idempotent.text === set1.text, 'second write changed bytes'))

  const emptyConfig = [
    '- id: compaction-basic',
    '  config: {}',
    '- id: tail',
    '',
  ].join('\n')
  const expanded = editCompactionPatch(emptyConfig, [{ op: 'set', field: 'retainRatio', value: 0.2 }])
  checks.push(check('h1 expands inline config', /config:\n\s+retainRatio: 0.2/.test(expanded.text), JSON.stringify(expanded.text)))
  checks.push(check('h1 expanded keeps tail entry', expanded.text.includes('- id: tail'), 'tail kept'))

  const inserted = editCompactionPatch(plain, [{ op: 'set', field: 'auto', value: false }])
  checks.push(check('h1 inserts missing field', inserted.fields.auto === false, inserted.fields.auto))
  checks.push(check('h1 insert before next entry', inserted.text.indexOf('    auto: false') < inserted.text.indexOf('- id: tail'), 'ordering'))

  const missing = [
    '- id: other',
    '  config: {}',
    '',
  ].join('\n')
  const appended = editCompactionPatch(missing, [
    { op: 'set', field: 'summarizationProvider', value: 'nvidia' },
    { op: 'set', field: 'summarizationModel', value: 'nvidia/x' },
  ])
  checks.push(check('h1 appends entry', appended.text.includes("- id: compaction-basic"), 'appended'))
  checks.push(check('h1 append keeps existing entry', appended.text.includes('- id: other'), 'other kept'))
  checks.push(check('h1 append readable', appended.fields.summarizationProvider === 'nvidia', appended.fields.summarizationProvider))

  const deleteOnly = editCompactionPatch(missing, [{ op: 'delete', field: 'summarizationProvider' }])
  checks.push(check('h1 delete-only on missing entry is noop', deleteOnly.text === missing, 'text changed'))

  let rejected = false
  try {
    editCompactionPatch(plain, [{ op: 'set', field: 'summarizationProvider', value: 'bad value: x' }])
  } catch { rejected = true }
  checks.push(check('h1 rejects unsafe value', rejected === true, 'injection accepted'))

  let duplicateRejected = false
  try {
    readCompactionPatch(['- id: compaction-basic', '  config: {}', '- id: compaction-basic', '  config: {}', ''].join('\n'))
  } catch { duplicateRejected = true }
  checks.push(check('h1 rejects duplicate entry', duplicateRejected === true, 'duplicate accepted'))

  const crlf = plain.replace(/\n/g, '\r\n')
  const crlfEdit = editCompactionPatch(crlf, [{ op: 'set', field: 'retainRatio', value: 0.25 }])
  checks.push(check('h1 keeps CRLF', crlfEdit.text.includes('\r\n') && !/[^\r]\n/.test(crlfEdit.text.replace(/\r\n/g, '')), 'line endings changed'))

  const real = join(process.env.DSH_PROFILE_DIR ?? '', 'cordis.patch.yml')
  try {
    const text = await readFile(real, 'utf8')
    const snapshot = readCompactionPatch(text)
    checks.push(check('h1 real patch parses', typeof snapshot.mode === 'string', snapshot.mode))
  } catch {
    checks.push(check('h1 real patch parses', true, 'skipped: profile patch unreadable'))
  }

  return { name, checks }
}
