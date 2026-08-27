#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Fail when the launch-day runbook tells its reader to run something that is
// not there (AGL-1533).
//
//   npm run check:runbook-commands
//   npm run check:runbook-commands -- --list      # every reference and its verdict
//   npm run check:runbook-commands -- --self-test # prove the red path reds
//
// The extractor and its reasoning live in `lib/runbook-commands.mjs`.
//
// ## EXIT CODES — 2 IS NOT A PASS
//
//   0  every referenced script and npm target resolves
//   1  at least one does not
//   2  INCONCLUSIVE — the Platform Docs shared drive is not mounted, so the
//      document could not be read at all
//
// The third state is the whole point. This document lives in Google Drive, not
// in the repo, so the "file not found" case is ambiguous in a way that matters:
// on a machine without the shared drive mounted, a two-state check reports
// green over a document it never opened. That is the exact shape of the
// failures this runbook keeps producing — a control that is green because it
// read the wrong thing. CI must treat 2 as "unknown", never as "fine".

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateRunbookCommands,
  formatFinding,
} from './lib/runbook-commands.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const DEFAULT_LAUNCH_DIR = join(
  process.env['HOME'] ?? '',
  'Library/CloudStorage/GoogleDrive-zach@aglyn.com/Shared drives/Platform Docs',
  'Release & Launch',
)

const runbookPath =
  process.env['AGLYN_RUNBOOK'] ||
  join(process.env['AGLYN_LAUNCH_DOCS'] || DEFAULT_LAUNCH_DIR, 'LAUNCH_DAY_RUNBOOK.md')

/** package.json script names. */
function scriptNames() {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  return new Set(Object.keys(pkg.scripts ?? {}))
}

/**
 * How many files a reference resolves to. Glob-aware, because the runbook
 * says `deploy-*-rules.mjs` and a glob that matches nothing is the same
 * defect as a path that does not exist.
 */
function resolveCount(ref) {
  if (!ref.includes('*')) return existsSync(join(repoRoot, ref)) ? 1 : 0
  const dir = dirname(ref)
  const pattern = ref.slice(dir.length + 1)
  const abs = join(repoRoot, dir)
  if (!existsSync(abs)) return 0
  const re = new RegExp(
    `^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
  )
  try {
    return readdirSync(abs).filter((f) => re.test(f)).length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Self-test — the red path, driven on purpose.
// ---------------------------------------------------------------------------

function selfTest() {
  let failures = 0
  const check = (name, actual, expected) => {
    const ok = actual === expected
    if (!ok) failures++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} (got ${actual}, want ${expected})`)
  }

  const dir = mkdtempSync(join(tmpdir(), 'runbook-selftest-'))
  const scripts = scriptNames()

  // 1. POSITIVE CONTROL. Real references must pass — otherwise a green run
  //    below would only prove the extractor matches nothing.
  const good = [
    'Run `tools/scripts/deploy-firestore-rules.mjs` from the pinned worktree.',
    'Then `npm run check:rules-drift` and read stderr.',
    'The resolver is `libs/aglyn/src/lib/app-utils/lockdown.ts`.',
    'Blind spots are in docs/UPTIME_AND_SLA.md.',
  ].join('\n')
  const goodResult = evaluateRunbookCommands(good, { resolve: resolveCount, scripts })
  check('positive control: real references resolve', goodResult.findings.length, 0)
  check('positive control: found 4 references', goodResult.checked.length, 4)

  // 2. THE FAILURE THIS WAS BUILT FROM. `verify-production-aliases.mjs` is at
  //    tools/deploy/, not tools/scripts/. The runbook's companion prose said
  //    tools/scripts/. This must red.
  const wrongPath = 'Before tagging, run `node tools/scripts/verify-production-aliases.mjs`.'
  const wrongResult = evaluateRunbookCommands(wrongPath, { resolve: resolveCount, scripts })
  check('the real-world miss reds', wrongResult.findings.length, 1)
  check(
    'and the correct path passes',
    evaluateRunbookCommands(
      'run `node tools/deploy/verify-production-aliases.mjs`',
      { resolve: resolveCount, scripts },
    ).findings.length,
    0,
  )

  // 3. A missing npm target must red.
  const badNpm = evaluateRunbookCommands('Now run `npm run check:not-a-real-target`.', {
    resolve: resolveCount,
    scripts,
  })
  check('a missing npm target reds', badNpm.findings.length, 1)
  check('and it is reported as an npm finding', badNpm.findings[0]?.kind, 'npm')

  // 4. A glob that resolves to nothing must red; the runbook's real glob passes.
  check('a glob matching nothing reds', resolveCount('tools/scripts/deploy-*-nothing.mjs'), 0)
  check('the runbook glob resolves', resolveCount('tools/scripts/deploy-*-rules.mjs') > 0, true)

  // 5. END TO END, through the actual file reader — a fixture on disk naming a
  //    script that does not exist. This is the check pointed at a missing
  //    script, proving the whole CLI path reds and not just the evaluator.
  const fixture = join(dir, 'FIXTURE_RUNBOOK.md')
  writeFileSync(
    fixture,
    '# fixture\n\nStep 1 — run `node tools/scripts/this-script-does-not-exist.mjs`.\n',
  )
  const fixtureText = readFileSync(fixture, 'utf8')
  const fixtureResult = evaluateRunbookCommands(fixtureText, {
    resolve: resolveCount,
    scripts,
  })
  check('on-disk fixture with a missing script reds', fixtureResult.findings.length, 1)
  check('exit code for that fixture would be 1', fixtureResult.findings.length ? 1 : 0, 1)

  console.log(
    failures === 0
      ? '\nrunbook-commands self-test: PASS'
      : `\nrunbook-commands self-test: ${failures} FAILED`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) return selfTest()

  if (!existsSync(runbookPath)) {
    console.error(
      `\n❓ INCONCLUSIVE — could not read the runbook.\n\n  ${runbookPath}\n\n` +
        'This is exit 2, not a pass. The document lives in the "Platform Docs"\n' +
        'shared drive (Release & Launch), so an unmounted drive looks exactly\n' +
        'like a clean run. Mount the drive, or point AGLYN_RUNBOOK at a copy.\n',
    )
    process.exit(2)
  }

  const text = readFileSync(runbookPath, 'utf8')
  const scripts = scriptNames()
  const { checked, findings } = evaluateRunbookCommands(text, {
    resolve: resolveCount,
    scripts,
  })

  if (argv.includes('--list')) {
    for (const c of [...checked].sort((a, b) => a.ref.localeCompare(b.ref))) {
      const label = c.kind === 'npm' ? `npm run ${c.ref}` : c.ref
      console.log(`  ${c.matches > 0 ? '✅' : '❌'}  ${label}`)
    }
    console.log('')
  }

  console.log(
    `Checked ${checked.length} runnable reference(s) in ${runbookPath.split('/').pop()}.`,
  )

  if (!findings.length) {
    console.log('✅ Every script and npm target the launch runbook names exists.')
    process.exit(0)
  }

  console.error(`\n❌ ${findings.length} reference(s) the runbook names do not exist:\n`)
  for (const f of findings) console.error(formatFinding(f))
  console.error(
    '\nThis document is executed once, by one person, under time pressure. A\n' +
      'wrong path is `Cannot find module` at 6am. Either fix the path in the\n' +
      'runbook (Platform Docs → Release & Launch) or add the missing script.\n',
  )
  process.exit(1)
}

main()
