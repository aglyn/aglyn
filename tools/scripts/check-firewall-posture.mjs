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

// Fails when the LIVE Vercel WAF posture differs from the table declared in
// `lib/firewall-posture.mjs` (AGL-2483).
//
//   npm run check:firewall-posture
//   npm run check:firewall-posture -- --strict   # known gaps count as failures
//   npm run check:firewall-posture -- --json
//   npm run check:firewall-posture -- --fixture=/tmp/doctored.json
//
// Nothing here writes. One GET per project, and the script has no write path
// at all — deliberately, see below.
//
// ⚠️ WHY THIS CHECKER EXISTS — `PUT` DELETES MANAGED RULES AND RETURNS 200.
// On 2026-08-21 a single custom rule added to `aglyn-tenant` via
// `PUT /v1/security/firewall/config` was inserted correctly AND silently
// disabled bot protection for every tenant site. The API rejects
// `managedRules` as an input key, so you are forced to omit it, and it reads
// the omission as a delete. The full explanation, and the safe `PATCH
// managedRules.update` form, are in the header of `lib/firewall-posture.mjs`.
// Read that before touching any firewall config by hand.
//
// This script will never repair anything. There is no `--fix`. A firewall is
// not a thing a cron job should reach in and edit, and the repair is a
// one-line PATCH a human can run with the blast radius in front of them.
//
// Auth: `VERCEL_TOKEN` — the same variable `tools/deploy/verify-production-aliases.mjs`
// and `verify-env-isolation.mjs` already use. Locally it falls back to the
// Vercel CLI's own auth file, i.e. the credential `vercel` is already logged
// in with; no new secret to run it by hand. That fallback is DISABLED when
// `CI` is set, so a CI run can only ever use the repo secret and cannot pass
// by accidentally finding a developer credential baked into an image.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  every project matches its declared posture
//   1  drift: protection off/weakened, a bypass rule missing or widened, an
//      undeclared bypass rule, or a known gap that has silently changed
//   2  cannot check: no token, an API refusal, or a malformed posture table

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  EXPECTED_POSTURE,
  TEAM_SCOPE,
  evaluatePosture,
  fetchFirewallConfig,
  formatReport,
  validatePostureTable,
} from './lib/firewall-posture.mjs'

const args = process.argv.slice(2)
const STRICT = args.includes('--strict')
const JSON_OUT = args.includes('--json')
const fixturePath = args.find((a) => a.startsWith('--fixture='))?.slice('--fixture='.length)

if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: node tools/scripts/check-firewall-posture.mjs [--strict] [--json] [--fixture=<file>]\n\n' +
      'Asserts the live Vercel WAF posture of every project against the table in\n' +
      'tools/scripts/lib/firewall-posture.mjs: firewallEnabled, managed bot\n' +
      'protection set to challenge, and every declared bypass rule still present\n' +
      'AND still scoped.\n\n' +
      '  --strict         known, documented gaps also fail (launch-readiness view)\n' +
      '  --fixture=<file> read configs from a JSON file instead of the Vercel API,\n' +
      '                   as { "<project>": <config>|null }. For exercising this\n' +
      '                   checker against a doctored config WITHOUT touching live.\n\n' +
      'Exit codes: 0 matches, 1 drift, 2 cannot check.',
  )
  process.exit(0)
}

const unknown = args.filter(
  (a) => !['--strict', '--json'].includes(a) && !a.startsWith('--fixture='),
)
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(' ')} (try --help)`)
  process.exit(2)
}

function fail(message) {
  console.error(message)
  process.exit(2)
}

/**
 * `VERCEL_TOKEN` first, then the Vercel CLI's own auth file — the existing
 * convention in tools/deploy. The CLI fallback is refused under CI on
 * purpose: the CI job must prove it has the repo secret.
 */
function readVercelToken() {
  const fromEnv = process.env.VERCEL_TOKEN
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  if (process.env.CI) return null
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.vercel', 'auth.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (typeof token === 'string' && token.length > 0) return token.trim()
    } catch {
      // Unreadable/!JSON — try the next candidate.
    }
  }
  return null
}

async function loadConfigs() {
  const configs = new Map()

  if (fixturePath !== undefined) {
    let fixture
    try {
      fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
    } catch (error) {
      fail(`Cannot read fixture ${fixturePath}: ${error.message}`)
    }
    for (const entry of EXPECTED_POSTURE) {
      if (!Object.prototype.hasOwnProperty.call(fixture, entry.project)) {
        fail(
          `Fixture ${fixturePath} has no entry for "${entry.project}". Give every project a ` +
            'config object, or null to model "no config exists".',
        )
      }
      configs.set(entry.project, fixture[entry.project])
    }
    console.error(`(reading ${EXPECTED_POSTURE.length} configs from fixture ${fixturePath}, not from Vercel)`)
    return configs
  }

  const token = readVercelToken()
  if (token === null) {
    fail(
      'No Vercel API token. Set VERCEL_TOKEN (in CI: the repo secret of that name),\n' +
        'or log in with the Vercel CLI locally.\n\n' +
        'Exiting 2 rather than 0: this check cannot see the live firewall without a\n' +
        'token, and a green run that read nothing is the exact silent failure it\n' +
        'exists to prevent — a PUT to the firewall config returns 200 while deleting\n' +
        'managed bot protection, and only a read-back reveals it (AGL-2483).\n\n' +
        'Create the secret once, from a Vercel access token scoped to the aglyn team:\n' +
        "  gh secret set VERCEL_TOKEN --body '<token>'",
    )
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim() || TEAM_SCOPE
  const failures = []
  await Promise.all(
    EXPECTED_POSTURE.map(async (entry) => {
      const result = await fetchFirewallConfig({ token, projectId: entry.project, teamId })
      if (!result.ok) {
        failures.push(`${entry.project}: ${result.error}`)
        return
      }
      configs.set(entry.project, result.config)
    }),
  )
  if (failures.length > 0) {
    fail(
      'Could not read the live firewall config for:\n  ' +
        failures.join('\n  ') +
        '\n\nExiting 2 (cannot check), not 1. A token lacking team scope reports 403 here.',
    )
  }
  return configs
}

async function main() {
  const problems = validatePostureTable(EXPECTED_POSTURE)
  if (problems.length > 0) {
    fail(
      'The expected-posture table is malformed — refusing to report on it:\n  ' +
        problems.join('\n  ') +
        '\n\nSee the mode guard in tools/scripts/lib/firewall-posture.mjs.',
    )
  }

  const configs = await loadConfigs()
  const result = evaluatePosture({ configs, strict: STRICT })

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(formatReport(result))
  }
  process.exit(result.ok ? 0 : 1)
}

main().catch((error) => {
  fail(`Unexpected failure: ${error?.stack ?? error}`)
})
