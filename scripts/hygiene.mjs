// Repo hygiene gate, run in CI. Fails on:
// - console.log anywhere in src/ (stdout is the MCP JSON-RPC channel)
// - em or en dashes in source, README, or CLAUDE.md (house rule)
// - uppercase-acronym identifier casing (sendSMS, getSMS) that the SDK style bans
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures = []

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

const sourceFiles = walk('src')
const proseFiles = ['README.md', 'CLAUDE.md']

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8')
  if (/\bconsole\.log\b/.test(text)) {
    failures.push(`${file}: console.log is banned, stdout is the JSON-RPC channel; use stderr`)
  }
  if (/\b(sendSMS|getSMS|receiveSMS|sendBulkSMS)\b/.test(text)) {
    failures.push(`${file}: acronyms are words in identifiers (sendSms, not sendSMS)`)
  }
}

for (const file of [...sourceFiles, ...proseFiles]) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('—') || line.includes('–')) {
      failures.push(`${file}:${i + 1}: em or en dash found; use a period, comma, colon, or hyphen`)
    }
  })
}

if (failures.length > 0) {
  console.error('hygiene check failed:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.error(`hygiene check passed (${sourceFiles.length + proseFiles.length} files).`)
