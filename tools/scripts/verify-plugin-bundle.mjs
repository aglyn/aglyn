/**
 * Pre-publish plugin bundle verifier (AGL-426) — Strapi
 * `strapi-plugin verify` parity.
 *
 *   node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs
 *   node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs manifest.json
 *
 * Runs the same static checks the publish API enforces, over the bundle's
 * parse tree (entry exports, self-containment, forbidden APIs, size,
 * network calls vs the manifest), lists every area it checked, then prints
 * the sha256 and a manifest snippet. Exit 1 on any error-level problem.
 *
 * The manifest is read too — from the second argument, or `manifest.json`
 * beside the bundle — because the checker diffs the bundle's network calls
 * against `capabilities.network` (AGL-964). Without it the network findings
 * are warnings here and errors at publish, which is exactly the local/server
 * drift this script exists to prevent, so a missing manifest is called out.
 *
 * The checks are compiled from the same source of truth the server uses
 * (libs/aglyn app-utils/plugin-bundle-checks.ts) via esbuild, so local
 * and server verdicts can't drift.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [, , bundlePath, manifestArg] = process.argv
if (!bundlePath) {
  console.error('Usage: node tools/scripts/verify-plugin-bundle.mjs <bundle>')
  process.exit(1)
}

// Compile the shared checks module on the fly (keeps ONE source of truth).
const outFile = join(mkdtempSync(join(tmpdir(), 'aglyn-verify-')), 'checks.mjs')
execSync(
  `npx esbuild ${JSON.stringify(
    join(repoRoot, 'libs/aglyn/src/lib/app-utils/plugin-bundle-checks.ts'),
  )} --bundle --format=esm --platform=node --outfile=${JSON.stringify(outFile)}`,
  { cwd: repoRoot, stdio: 'pipe' },
)
const { checkPluginBundle } = await import(pathToFileURL(outFile).href)

// The manifest the publish API will check this bundle against. Beside the
// bundle or one level up (`dist/plugin.bundle.mjs` + `manifest.json` is the
// layout the template and the examples use).
const bundleDir = dirname(bundlePath)
const manifestCandidates = manifestArg
  ? [manifestArg]
  : [join(bundleDir, 'manifest.json'), join(bundleDir, '..', 'manifest.json')]
let declaredNetwork
for (const candidate of manifestCandidates) {
  try {
    const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
    declaredNetwork = manifest?.capabilities?.network ?? []
    console.log(
      `Manifest: ${candidate} (network: ${
        declaredNetwork.length ? declaredNetwork.join(', ') : 'none declared'
      })`,
    )
    break
  } catch {
    // Try the next candidate; absence is reported once, below.
  }
}
if (!declaredNetwork) {
  console.log(
    `No manifest found (looked in ${manifestCandidates.join(', ')}) — ` +
      'network calls can only be WARNED about here; the publish API will ' +
      'check them against capabilities.network and reject. Pass the ' +
      'manifest as the second argument for the verdict you will actually get.',
  )
}

const source = readFileSync(bundlePath, 'utf8')
const result = checkPluginBundle(source, { declaredNetwork })

// Every area, not only the ones with findings (AGL-1087) — the same summary
// a reviewer sees, so a publisher can tell "checked and clean" from "never
// checked" before submitting.
const MARK = { pass: '✓', fail: '✕', question: '?', unknown: '—' }
for (const check of result.checks ?? []) {
  const detail = check.detail ? `  (${check.detail})` : ''
  const note = check.status === 'unknown' ? '  — not checked' : ''
  console.log(`${MARK[check.status] ?? '?'} ${check.label}${note}${detail}`)
  for (const problem of result.problems.filter((p) => p.check === check.id)) {
    console.log(`    ${problem.level.toUpperCase()}: ${problem.message}`)
  }
}
for (const problem of result.problems.filter((p) => !p.check)) {
  console.log(`${problem.level.toUpperCase()}: ${problem.message}`)
}
if (!result.ok) {
  console.log('\nBundle FAILED verification — the publish API will reject it.')
  process.exit(1)
}

const sha256 = createHash('sha256')
  .update(readFileSync(bundlePath))
  .digest('hex')
console.log('Bundle OK.')
console.log(`  exports: ${Object.entries(result.exports)
  .filter(([, present]) => present)
  .map(([name]) => name)
  .join(', ')}`)
console.log(`  sha256:  ${sha256}`)
console.log(`
Manifest snippet (keep id/version in step with manifest.json):
  { "version": "<version>", "sha256": "${sha256}", "entry": "plugin.bundle.mjs" }
`)
