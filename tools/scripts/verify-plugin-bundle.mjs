/**
 * Pre-publish plugin bundle verifier (AGL-426) — Strapi
 * `strapi-plugin verify` parity.
 *
 *   node tools/scripts/verify-plugin-bundle.mjs dist/plugin.bundle.mjs
 *
 * Runs the same static checks the publish API enforces (entry exports,
 * self-containment, forbidden APIs, size), then prints the sha256 and a
 * manifest snippet. Exit 1 on any error-level problem.
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
const [, , bundlePath] = process.argv
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

const source = readFileSync(bundlePath, 'utf8')
const result = checkPluginBundle(source)

for (const problem of result.problems) {
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
