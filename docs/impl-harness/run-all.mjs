import { name as h1name, run as runH1 } from './h1-patch-editor.mjs'
import { name as h2name, run as runH2 } from './h2-routes.mjs'
import { name as h3name, run as runH3 } from './h3-client-ui.mjs'
import { name as h4name, run as runH4 } from './h4-runtime.mjs'

const suites = [
  [h1name, runH1],
  [h2name, runH2],
  [h3name, runH3],
  [h4name, runH4],
]

const results = []
let allPassed = true
for (const [name, run] of suites) {
  try {
    const result = await run()
    const failed = result.checks.filter((entry) => entry.ok !== true)
    if (failed.length > 0) allPassed = false
    results.push({ name, passed: failed.length === 0, failed, total: result.checks.length })
  } catch (error) {
    allPassed = false
    results.push({ name, passed: false, failed: [{ label: 'suite crashed', ok: false, detail: error instanceof Error ? error.stack : String(error) }], total: 0 })
  }
}

for (const result of results) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name} (${result.total} checks)`)
  for (const entry of result.failed) console.log(`  FAIL ${entry.label}: ${entry.detail}`)
}
console.log(JSON.stringify({ allPassed, results }, null, 2))
process.exitCode = allPassed ? 0 : 1
