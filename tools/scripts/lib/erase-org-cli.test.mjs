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

/**
 * Pins AGL-1481: the manual erasure tool is a caller, not a copy.
 *
 *   node --test tools/scripts/lib/erase-org-cli.test.mjs
 *
 * Two defects are pinned here, and the second is the one that will come back.
 *
 * **It wrote the dump.** `erase-tenant.mjs` produced a complete verbatim copy
 * of the org tree and every host tree — `webhooks.secret`,
 * `orders.paymentLinkUrl` (a live payable bearer URL),
 * `screens.protection.passwordHash`, `ssoDomains.token` — into the operator's
 * CURRENT WORKING DIRECTORY. Working customer credentials on a laptop, no
 * retention, no access control, no record it existed, for a customer who had
 * just been told their workspace was gone. AGL-1443 removed the same write
 * from the served path; this was the other producer.
 *
 * **It reimplemented the cascade, and drifted.** Within a week of
 * `eraseOrgApiKeys` (AGL-1444) and the SSO / console-domain / org-keyed index
 * sweeps (AGL-1448) landing in `eraseOrg`, the script had none of them — so a
 * manual erasure left a live API credential, live domain reservations,
 * `orgSlugs` tombstones and a `stripeCustomers` reverse index standing, while
 * printing success. The structural test at the bottom is the guard against
 * that returning: porting a sweep back into the script fails it.
 *
 * The residue an erasure actually leaves is asserted against the emulator in
 * `libs/tenant/data/admin/src/lib/server/erase-org-script.emulator.spec.ts`,
 * which also runs THIS script end to end and watches its working directory.
 */

import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { runEraseOrgCli, parseEraseArgs, USAGE } from './erase-org-cli.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY_POINT = resolve(HERE, '..', 'erase-tenant.mjs')

/** Collects the call so a test can assert WHICH call the script makes. */
function spyEraseOrg(result) {
  const calls = []
  const eraseOrg = async (...args) => {
    calls.push(args)
    return result
  }
  return { eraseOrg, calls }
}

/** Swallows the CLI's output; a test that wants it passes its own sink. */
const quiet = () => undefined

/**
 * Run the CLI standing in an empty throwaway directory, and report anything
 * that appeared in it. This is the assertion the dump defect fails.
 */
async function runInEmptyCwd(options) {
  const cwd = mkdtempSync(join(tmpdir(), 'aglyn-erase-cli-'))
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    const code = await runEraseOrgCli({ log: quiet, warn: quiet, ...options })
    return { code, written: readdirSync(cwd) }
  } finally {
    process.chdir(previous)
    rmSync(cwd, { recursive: true, force: true })
  }
}

// ------------------------------------------------------- the call it makes

test('a plan is `eraseOrg(orgId, { dryRun: true })` and nothing else', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ skippedReason: 'dry-run', ok: false })
  const code = await runEraseOrgCli({
    argv: ['--org', 'acme'],
    eraseOrg,
    log: quiet,
    warn: quiet,
  })
  assert.equal(code, 0)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [
    'acme',
    { dryRun: true, actorUid: 'script:erase-tenant' },
  ])
})

test('--confirm is the same call with dryRun false', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ ok: true, hosts: 2 })
  const code = await runEraseOrgCli({
    argv: ['--org', 'acme', '--confirm'],
    eraseOrg,
    log: quiet,
    warn: quiet,
  })
  assert.equal(code, 0)
  assert.deepEqual(calls[0], [
    'acme',
    { dryRun: false, actorUid: 'script:erase-tenant' },
  ])
})

test('--actor names the human in the audit row instead of the cron', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ ok: true })
  await runEraseOrgCli({
    argv: ['--org', 'acme', '--confirm', '--actor', 'staff:zach'],
    eraseOrg,
    log: quiet,
    warn: quiet,
  })
  assert.equal(calls[0][1].actorUid, 'staff:zach')
})

// ------------------------------------------------- nothing reaches the disk

test('THE DEFECT: a completed erasure writes no file to the working directory', async () => {
  // The success branch is exactly where `writeFileSync(exportPath, …)` stood.
  const { eraseOrg } = spyEraseOrg({
    ok: true,
    hosts: 3,
    members: 4,
    apiKeys: 2,
    ssoDomains: 1,
    consoleDomains: 1,
    apiIdempotency: 9,
    stripeIndex: 1,
    slugs: 2,
  })
  const { code, written } = await runInEmptyCwd({
    argv: ['--org', 'acme', '--confirm'],
    eraseOrg,
  })
  assert.equal(code, 0)
  assert.deepEqual(written, [])
})

test('a plan writes no file either', async () => {
  const { eraseOrg } = spyEraseOrg({ ok: false, skippedReason: 'dry-run', hosts: 1 })
  const { code, written } = await runInEmptyCwd({ argv: ['--org', 'acme'], eraseOrg })
  assert.equal(code, 0)
  assert.deepEqual(written, [])
})

// ------------------------------------------------------------- the guards

test('a refusal from the shared function is reported and exits non-zero', async () => {
  for (const reason of ['not-found', 'no-request', 'hold-active']) {
    const { eraseOrg } = spyEraseOrg({ ok: false, skippedReason: reason })
    const said = []
    const code = await runEraseOrgCli({
      argv: ['--org', 'acme', '--confirm'],
      eraseOrg,
      log: quiet,
      warn: (line) => said.push(line),
    })
    assert.equal(code, 1, `${reason} must not exit 0`)
    assert.match(said.join('\n'), /REFUSED/)
  }
})

test('there is no hold bypass to reach', () => {
  // Deliberate: the one difference between the operator path and the served
  // path that is worth keeping is that NEITHER can skip the reversible hold.
  const parsed = parseEraseArgs(['--org', 'acme', '--ignore-hold', '--force'])
  assert.deepEqual(Object.keys(parsed).sort(), [
    'actorUid',
    'confirm',
    'legacyTenant',
    'orgId',
  ])
  assert.equal(readFileSync(ENTRY_POINT, 'utf8').includes('ignore-hold'), false)
})

test('--confirm is refused against the emulator (there is no Storage emulator)', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ ok: true })
  const said = []
  const code = await runEraseOrgCli({
    argv: ['--org', 'acme', '--confirm'],
    eraseOrg,
    emulated: true,
    log: quiet,
    warn: (line) => said.push(line),
  })
  assert.equal(code, 1)
  assert.equal(calls.length, 0, 'it must not reach eraseOrg at all')
  assert.match(said.join('\n'), /Storage emulator/)
})

test('the retired --tenant mode explains itself instead of erasing', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ ok: true })
  const said = []
  const code = await runEraseOrgCli({
    argv: ['--tenant', 'uid-123', '--confirm'],
    eraseOrg,
    log: quiet,
    warn: (line) => said.push(line),
  })
  assert.equal(code, 1)
  assert.equal(calls.length, 0)
  assert.match(said.join('\n'), /eraseUser/)
})

test('no target is a usage error, not a no-op success', async () => {
  const { eraseOrg, calls } = spyEraseOrg({ ok: true })
  const said = []
  const code = await runEraseOrgCli({
    argv: ['--confirm'],
    eraseOrg,
    log: quiet,
    warn: (line) => said.push(line),
  })
  assert.equal(code, 1)
  assert.equal(calls.length, 0)
  assert.equal(said.join('\n'), USAGE)
})

// --------------------------------------------- the anti-drift guard itself

test('THE DEFECT: the script contains no erasure logic of its own', () => {
  // This is the test that keeps AGL-1481 closed. The script diverged because
  // it held a second copy of the cascade; every token below is a piece of that
  // copy, and re-adding any of them here — rather than in `eraseOrg` — is the
  // start of the same drift. If a sweep is missing from a manual erasure, it
  // is missing from the served one too, and it belongs in the shared function.
  const sources = [ENTRY_POINT, join(HERE, 'erase-org-cli.mjs')]
  const forbidden = [
    // A second implementation of the cascade.
    'recursiveDelete',
    'deleteFiles',
    'hostIndex',
    'orgSlugs',
    'apiKeys',
    'ssoDomains',
    'stripeCustomers',
    'apiIdempotency',
    'adminAudit',
    'api.stripe.com',
    // A second copy of the workspace, on the operator's laptop.
    'writeFileSync',
    'createWriteStream',
    'appendFileSync',
    'exportDocTree',
  ]
  for (const file of sources) {
    const source = readFileSync(file, 'utf8')
    // Comments explain the removed logic by name, so only CODE is inspected.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    for (const token of forbidden) {
      assert.equal(
        code.includes(token),
        false,
        `${file} must not contain \`${token}\` — that lives in eraseOrg`,
      )
    }
  }
})

test('the entry point calls the same module the cron route does', () => {
  // `includes` rather than `assert.match`: a failing regex assertion prints
  // the entire script as the actual value, which buries the one line that
  // matters under 400 lines of the thing being removed.
  const source = readFileSync(ENTRY_POINT, 'utf8')
  assert.equal(
    source.includes('libs/tenant/data/admin/src/lib/server/erase.ts'),
    true,
    'the script must load eraseOrg from the shared implementation',
  )
})
