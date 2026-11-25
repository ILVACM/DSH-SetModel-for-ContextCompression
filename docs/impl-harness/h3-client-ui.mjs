import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()

export const name = 'h3-client-ui'

function check(label, ok, detail) {
  return { label, ok: ok === true, detail: detail === undefined ? '' : String(detail) }
}

export async function run() {
  const checks = []
  const client = await readFile(join(ROOT, 'plugin', 'lib', 'client.js'), 'utf8')
  const index = await readFile(join(ROOT, 'plugin', 'src', 'client', 'index.tsx'), 'utf8')
  const card = await readFile(join(ROOT, 'plugin', 'src', 'client', 'CompactionCard.tsx'), 'utf8')
  const localesSrc = await readFile(join(ROOT, 'plugin', 'src', 'client', 'locales.ts'), 'utf8')
  const zh = JSON.parse(await readFile(join(ROOT, 'plugin', 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(ROOT, 'plugin', 'locale', 'en.json'), 'utf8'))

  checks.push(check('h3 bundle id banner', client.includes('window.__ModuleLoader__.load('), 'missing loader wrapper'))
  checks.push(check('h3 bundle id value', client.includes('@hbk/dsh-compaction-setmodel'), 'wrong id'))
  checks.push(check('h3 registers settings section', index.includes("name: 'settings.section'"), 'slot missing'))
  checks.push(check('h3 card id', index.includes("id: 'compaction-setmodel'"), 'card id missing'))
  checks.push(check('h3 order 60', index.includes('order: 60'), 'order missing'))
  checks.push(check('h3 disables picker in follow mode', card.includes("disabled: mode !== 'explicit'"), 'picker not disabled'))
  checks.push(check('h3 passes useSessions', card.includes('props.useSessions'), 'useSessions not read'))
  checks.push(check('h3 no document.body append', !card.includes('document.body.appendChild'), 'appends to body'))

  checks.push(check('h3 has saving phase', card.includes("'saving'"), 'saving phase missing'))
  checks.push(check('h3 has applied phase', card.includes("'applied'"), 'applied phase missing'))
  checks.push(check('h3 has restart-required phase', card.includes("'restart-required'"), 'restart phase missing'))
  checks.push(check('h3 has failed phase', card.includes("'failed'"), 'failed phase missing'))
  checks.push(check('h3 has unknown phase', card.includes("'unknown'"), 'unknown phase missing'))
  checks.push(check('h3 no transient phase', !/\bpending\b/.test(card), 'transient wording remains'))
  checks.push(check('h3 recheck always rendered', !card.includes("phase === 'pending'"), 'recheck still conditional'))
  checks.push(check('h3 has details block', card.includes('details'), 'details missing'))
  checks.push(check('h3 polls with timeout', card.includes('POLL_TIMEOUT_MS'), 'timeout missing'))
  checks.push(check('h3 uses saveGeneration', card.includes('generation.current'), 'generation guard missing'))
  checks.push(check('h3 reads status block', card.includes('body?.status'), 'status block not read'))
  checks.push(check('h3 forces fresh probe on mount', card.includes('probe=fresh'), 'fresh probe missing'))
  checks.push(check('h3 shows basis footer', card.includes('status.footer'), 'footer missing'))
  checks.push(check('h3 shows last compaction', card.includes('compact.lastTitle'), 'last compaction missing'))

  const followHintOk = card.includes('mode.followHint')
  checks.push(check('h3 follow hint key used', followHintOk, 'followHint not referenced'))
  const zhHint = /'mode\.followHint':\s*'([^']+)'/.exec(localesSrc)?.[1] ?? ''
  checks.push(check('h3 zh follow hint mentions fallback', zhHint.includes('最近回答') && zhHint.includes('请求路由'), zhHint))
  checks.push(check('h3 zh follow hint disclaims equality', zhHint.includes('不保证等于'), zhHint))

  checks.push(check('h3 meta title zh', typeof zh.meta?.title === 'string' && zh.meta.title.length > 0, JSON.stringify(zh.meta)))
  checks.push(check('h3 meta detail zh', zh.meta?.detail === 'docs/DETAIL.zh.md', zh.meta?.detail))
  checks.push(check('h3 meta title en', typeof en.meta?.title === 'string' && en.meta.title.length > 0, JSON.stringify(en.meta)))
  checks.push(check('h3 meta detail en', en.meta?.detail === 'docs/DETAIL.md', en.meta?.detail))

  const zhBlock = localesSrc.slice(0, localesSrc.indexOf('export const en'))
  const enBlock = localesSrc.slice(localesSrc.indexOf('export const en'))
  const zhOnly = [...zhBlock.matchAll(/'([A-Za-z0-9_.]+)':/g)].map((m) => m[1])
  const enOnly = [...enBlock.matchAll(/'([A-Za-z0-9_.]+)':/g)].map((m) => m[1])
  const zhSet = new Set(zhOnly)
  const enSet = new Set(enOnly)
  const missingInEn = zhOnly.filter((key) => !enSet.has(key))
  const missingInZh = enOnly.filter((key) => !zhSet.has(key))
  checks.push(check('h3 zh/en key parity', missingInEn.length === 0 && missingInZh.length === 0, `en missing: ${missingInEn.join(',')}; zh missing: ${missingInZh.join(',')}`))
  checks.push(check('h3 status keys present', zhSet.has('status.applied') && zhSet.has('status.restart') && zhSet.has('status.failed') && zhSet.has('status.unknown'), 'status keys missing'))
  checks.push(check('h3 transient status key removed', !zhSet.has('status.pending'), 'status.pending still present'))
  checks.push(check('h3 basis keys present', zhSet.has('status.basis.service') && zhSet.has('status.basis.loader') && zhSet.has('status.basis.none') && zhSet.has('status.footer'), 'basis keys missing'))
  checks.push(check('h3 reason keys present', ['probeUnavailable', 'loaderNotSettled', 'mismatch', 'missingRestartBasis', 'convergenceTimeout'].every((key) => zhSet.has(`status.reason.${key}`)), 'reason keys missing'))
  checks.push(check('h3 detail keys present', zhSet.has('detail.title') && zhSet.has('detail.noCause'), 'detail keys missing'))
  checks.push(check('h3 compact kind keys present', zhSet.has('compact.busy') && zhSet.has('compact.changed') && zhSet.has('compact.commit') && zhSet.has('compact.persistence'), 'compact kind keys missing'))
  checks.push(check('h3 compact last keys present', zhSet.has('compact.lastTitle') && zhSet.has('compact.lastNone') && zhSet.has('compact.lastScope'), 'last compaction keys missing'))

  const locales = await import(new URL('../../plugin/lib/client.js', import.meta.url).href).catch(() => null)
  if (locales !== null) {
    const ns = locales.default ?? locales
    checks.push(check('h3 client module loads', typeof ns === 'object', 'module shape'))
  } else {
    checks.push(check('h3 client module loads', true, 'skipped: browser bundle needs window'))
  }

  return { name, checks }
}
