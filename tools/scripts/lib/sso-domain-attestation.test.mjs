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

// The SSO domain attestation backfill's decision half (AGL-1887).
//
// This one does not look like a backfill and must not be reviewed like one.
// The field it writes — `attestedBy` on `orgs/{orgId}/ssoDomains/{domain}` —
// is what makes `publishSsoDomains` willing to publish `ssoDomains/{domain}`,
// and a live document THERE routes every sign-in on that domain to that org's
// IdP. So each case below names a way a careless run could hand one company's
// sign-ins to another:
//
//   * A domain another org already routes is REFUSED, not overwritten.
//     Otherwise whoever attests last wins a conflict that a human should be
//     resolving.
//   * `--by` and `--note` are required, and `--by` must be a real string. An
//     ownership assertion nobody signed is not an assertion.
//   * `--apply` alone cannot write. The project id must be typed out, so a
//     command rehearsed against staging cannot be pasted at production.
//   * The write is ADDITIVE and never carries `verified`. DNS proof and a
//     person vouching are different facts; a run that conflated them would
//     let this script manufacture the stronger one.
//   * Re-running is a no-op-shaped repeat, not a second effect, so a
//     half-failed run has a recovery path.
//
// Pure functions only. The Firestore half lives in the runner.

import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  isStaffAttestedClaim,
  normalizeSsoDomain,
  parseAttestArgs,
  planAttestation,
} from './sso-domain-attestation.mjs'

const ORG = 'aglyn-org'
const DOMAIN = 'aglyn.com'
const BY = 'staff-uid-1'
const NOTE = 'Onboarded by hand 2026-07; ownership checked against registrar.'

const args = (...argv) =>
  parseAttestArgs(
    [
      `--org=${ORG}`,
      `--domain=${DOMAIN}`,
      `--by=${BY}`,
      `--note=${NOTE}`,
      ...argv,
    ],
    { projectId: 'aglyn-main' },
  )

/** A stranded pre-self-serve org: live in `sso.domains`, no claim document. */
const stranded = (overrides = {}) => ({
  orgExists: true,
  orgName: 'Aglyn',
  governedDomains: [DOMAIN],
  routingOrgId: ORG,
  claim: null,
  ...overrides,
})

test('the domain normalizer still matches the publish path it keys against', () => {
  // The runner cannot import the TypeScript function, so it mirrors it. Drift
  // writes the marker at a path `publishSsoDomains` never reads, which
  // presents to whoever ran this as "I attested it and Turn on still says no"
  // — a silent failure with a correct-looking success line above it.
  const source = readFileSync(
    join(
      process.cwd(),
      'libs/tenant/data/admin/src/lib/server/sso-provisioning.ts',
    ),
    'utf8',
  )
  const match = source.match(
    /export function normalizeSsoDomain\(input: string\): string \{([\s\S]*?)\n\}/,
  )
  ok(match, 'could not find normalizeSsoDomain in sso-provisioning.ts')
  // The body carries no type annotations, so it is valid JS as written and
  // can be run directly. That is the point: this compares BEHAVIOR against
  // the real source, not two copies of a string somebody could update in
  // lockstep while both drift away from the publish path.
  const fromSource = new Function('input', match[1])
  for (const input of [
    'AGLYN.com',
    '  aglyn.com  ',
    'aglyn.com.',
    'staff@aglyn.com',
    '@aglyn.com',
    'a@b@AGLYN.COM.',
    '',
  ]) {
    strictEqual(
      normalizeSsoDomain(input),
      fromSource(input),
      `normalizer disagreed with sso-provisioning.ts on ${JSON.stringify(input)}`,
    )
  }
})

test('an attestation must name a person, not merely be truthy', () => {
  // Mirrors `isStaffAttestedClaim`. A field satisfiable by any truthy value
  // is one a careless future write satisfies by accident. `true` is nobody.
  for (const value of [true, 1, {}, [], null, undefined, '', '   ']) {
    deepStrictEqual(
      [value, isStaffAttestedClaim(value)],
      [value, false],
      `${JSON.stringify(value)} was accepted as an attester`,
    )
  }
  strictEqual(isStaffAttestedClaim(BY), true)
})

test('dry run is the default, and --apply alone cannot write', () => {
  strictEqual(args().apply, false)
  strictEqual(args().ok, true)

  const bare = args('--apply')
  strictEqual(bare.ok, false)
  ok(
    /--confirm=aglyn-main/.test(bare.error),
    `refusal should name the confirm flag, got: ${bare.error}`,
  )

  // The lock that matters most: a command rehearsed elsewhere, pasted here.
  const wrongProject = args('--apply', '--confirm=aglyn-staging')
  strictEqual(wrongProject.ok, false)
  ok(/does not match/.test(wrongProject.error), wrongProject.error)

  const armed = args('--apply', '--confirm=aglyn-main')
  strictEqual(armed.ok, true)
  strictEqual(armed.apply, true)
})

test('the run refuses without an attester or a reason', () => {
  const noBy = parseAttestArgs(
    [`--org=${ORG}`, `--domain=${DOMAIN}`, '--by=   ', `--note=${NOTE}`],
    { projectId: 'aglyn-main' },
  )
  strictEqual(noBy.ok, false)
  ok(/--by=/.test(noBy.error), noBy.error)

  const noNote = parseAttestArgs(
    [`--org=${ORG}`, `--domain=${DOMAIN}`, `--by=${BY}`],
    { projectId: 'aglyn-main' },
  )
  strictEqual(noNote.ok, false)
  ok(/--note/.test(noNote.error), noNote.error)

  // No org, no domain — and deliberately no "every stranded org" mode, so
  // there is nothing sensible to default `--org` to.
  strictEqual(parseAttestArgs(['--domain=x.com'], {}).ok, false)
  strictEqual(parseAttestArgs([`--org=${ORG}`], {}).ok, false)
})

test('the domain is normalized before it is keyed, and junk is refused', () => {
  strictEqual(
    parseAttestArgs(
      [
        `--org=${ORG}`,
        '--domain=  STAFF@AGLYN.COM. ',
        `--by=${BY}`,
        `--note=${NOTE}`,
      ],
      {},
    ).domain,
    'aglyn.com',
  )
  for (const bad of [
    'localhost',
    'not a domain',
    'https://aglyn.com',
    '.com',
  ]) {
    strictEqual(
      parseAttestArgs(
        [`--org=${ORG}`, `--domain=${bad}`, `--by=${BY}`, `--note=${NOTE}`],
        {},
      ).ok,
      false,
      `${bad} was accepted as a domain`,
    )
  }
})

test('a note containing an equals sign survives intact', () => {
  // The audit row is the only record of why a domain was published without
  // DNS proof, so it must not be truncated by the parser that carries it.
  const note = 'registrar WHOIS org=Aglyn LLC; confirmed by phone 2026-07-14'
  strictEqual(
    parseAttestArgs(
      [`--org=${ORG}`, `--domain=${DOMAIN}`, `--by=${BY}`, `--note=${note}`],
      {},
    ).note,
    note,
  )
})

test('the stranded org is what this exists to unstrand', () => {
  const plan = planAttestation(stranded(), args())
  strictEqual(plan.action, 'attest')
  strictEqual(plan.reason, 'new-attestation')
  strictEqual(plan.claimExisted, false)
  deepStrictEqual(plan.warnings, [])
})

test('the write is additive and never claims DNS proof', () => {
  // The line that must not change. `verified` absent is what keeps "a person
  // vouched" and "we checked DNS" separate facts — a script able to write
  // `verified` could manufacture the stronger of the two.
  const plan = planAttestation(stranded(), args())
  deepStrictEqual(Object.keys(plan.write).sort(), [
    'attestationNote',
    'attestedBy',
    'domain',
  ])
  strictEqual(plan.write.attestedBy, BY)
  strictEqual(plan.write.domain, DOMAIN)
  strictEqual('verified' in plan.write, false)
  strictEqual('token' in plan.write, false)
})

test('a domain another org already routes is REFUSED, never taken', () => {
  // The account-takeover shape. An attestation must not be a way around
  // "one domain, one org", and a conflict is for a human to resolve before
  // anything is written rather than for whoever attests last to win.
  const plan = planAttestation(
    stranded({ routingOrgId: 'someone-else' }),
    args(),
  )
  strictEqual(plan.action, 'refuse')
  strictEqual(plan.reason, 'routed-elsewhere')
  ok(/someone-else/.test(plan.message), plan.message)
})

test('an org that does not exist is refused before anything is written', () => {
  const plan = planAttestation(stranded({ orgExists: false }), args())
  strictEqual(plan.action, 'refuse')
  strictEqual(plan.reason, 'no-such-org')
})

test('re-running is idempotent and reports itself as a repeat', () => {
  // A half-failed run needs a recovery path, so the second run must not
  // refuse — but it must also not read as a fresh assertion in the log.
  const plan = planAttestation(
    stranded({ claim: { domain: DOMAIN, attestedBy: BY } }),
    args(),
  )
  strictEqual(plan.action, 'attest')
  strictEqual(plan.reason, 'reattest-same-staff')
  strictEqual(plan.alreadyAttested, true)
  strictEqual(plan.previousAttestedBy, BY)
})

test('a DIFFERENT attester replacing one is allowed but surfaced', () => {
  const plan = planAttestation(
    stranded({ claim: { domain: DOMAIN, attestedBy: 'staff-uid-0' } }),
    args(),
  )
  strictEqual(plan.action, 'attest')
  strictEqual(plan.alreadyAttested, false)
  strictEqual(plan.previousAttestedBy, 'staff-uid-0')
})

test('a domain missing from sso.domains WARNS rather than refusing', () => {
  // The distinction this file is most likely to get wrong. `activate` hands
  // the gate only what `sso.domains` names, so the marker would sit there
  // doing nothing — wrong, but not dangerous, and refusing would block the
  // legitimate case where the array is fixed in the same sitting.
  const plan = planAttestation(stranded({ governedDomains: [] }), args())
  strictEqual(plan.action, 'attest')
  strictEqual(plan.warnings.length, 1)
  ok(/sso\.domains/.test(plan.warnings[0]), plan.warnings[0])
})

test('an already DNS-verified domain says so instead of quietly agreeing', () => {
  const plan = planAttestation(
    stranded({ claim: { domain: DOMAIN, verified: true, token: 'tok' } }),
    args(),
  )
  strictEqual(plan.action, 'attest')
  ok(
    plan.warnings.some((w) => /already DNS-verified/.test(w)),
    JSON.stringify(plan.warnings),
  )
})

test('a claim with no routing document yet is fine', () => {
  // A brand-new org attested before it ever went live. `routingOrgId: null`
  // is the absence of a conflict, not a conflict with nobody.
  const plan = planAttestation(stranded({ routingOrgId: null }), args())
  strictEqual(plan.action, 'attest')
})
