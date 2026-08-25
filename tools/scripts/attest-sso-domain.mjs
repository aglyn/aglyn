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

// Record a STAFF ATTESTATION that an org owns an SSO domain (AGL-1887).
//
// WHAT THIS IS FOR
//
// An org onboarded before self-serve SSO had its domain written straight onto
// `sso.domains` by a person who checked, with no claim document behind it.
// `unpublishSsoDomains` deactivates its routing happily and `publishSsoDomains`
// then refuses to bring it back — because it re-reads the claim and finds
// nothing proving ownership. Off works, on does not. For `aglyn-org` that is
// worse than an inconvenience: the owner's only credential lives inside the
// GCIP pool that stops answering (AGL-1888).
//
// AGL-1887 gave the attestation a representation the publish path recognizes:
// `attestedBy` on `orgs/{orgId}/ssoDomains/{domain}`. This script is what
// creates it for the orgs that predate the mechanism. Deploying the code alone
// unstrands nobody — there is nothing on those orgs saying anyone ever checked,
// which is deliberate. Inferring permission from the routing doc that is
// already there was the rejected alternative: it makes `unpublish` non-final
// for every org and lets a domain whose claim was revoked come back.
//
// ⚠️ THIS IS AN OWNERSHIP ASSERTION, NOT A FORMALITY. A live `ssoDomains/{domain}`
// doc routes every sign-in for that domain to the named org's IdP. Attesting a
// domain the org does not own hands them another company's sign-ins. Check the
// ownership yourself — the same check the pre-self-serve onboarding did — and
// put the evidence in --note. Your uid goes on the record, in `adminAudit`.
//
// The safe alternative, whenever it is available, is to have the customer
// publish the DNS TXT challenge and use the normal Verify button. That proves
// ownership rather than asserting it, and it needs no staff at all.
//
// HOW IT IS GATED (the house backfill posture — see
// `backfill-media-content-sha256.mjs`, whose locks these mirror):
//
//   * Dry run by default. It prints exactly what it would write and touches
//     nothing. Nothing opts INTO safety; `--apply` opts out of it.
//   * `--apply` is not enough on its own — it must be accompanied by
//     `--confirm=<projectId>`, typed out, so a command rehearsed against a
//     staging project cannot be pasted at production.
//   * One org and one domain per run. There is deliberately no mode that
//     sweeps every stranded org: each attestation is a separate human
//     assertion about a separate company's domain.
//   * Additive and idempotent. The write MERGES and never carries `verified`,
//     so a claim midway through DNS proof keeps its token and its verified
//     state, and re-running after a half-failed run is the recovery path
//     rather than a second effect.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/attest-sso-domain.mjs \
//       --org=aglyn-org --domain=aglyn.com --by=<staff-uid> \
//       --note='Onboarded by hand 2026-07; ownership confirmed via …' \
//       [--apply --confirm=aglyn-main]
//
// The decision half is pure and unit-tested in
// `tools/scripts/lib/sso-domain-attestation.{mjs,test.mjs}`; this file is the
// Firestore half only.

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import {
  parseAttestArgs,
  planAttestation,
} from './lib/sso-domain-attestation.mjs'

// Load admin creds from the repo's local env files so this script is
// self-contained. Already-set process.env wins.
function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  const files = roots.flatMap((r) => names.map((n) => `${r}/${n}`))
  for (const file of files) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const die = (message) => {
  console.error(`!! ${message}`)
  process.exit(1)
}

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) die('Missing FIREBASE_PROJECT_ID env var')

// Parsed BEFORE any Firebase connection: a refused command line must not have
// authenticated against production to find that out.
const parsed = parseAttestArgs(process.argv.slice(2), { projectId })
if (!parsed.ok) {
  console.error(`REFUSED: ${parsed.error}`)
  process.exit(2)
}

if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    die('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const { orgId, domain, by, note, apply } = parsed

console.log(
  parsed.apply
    ? `\nAPPLYING to ${projectId} — this asserts that "${orgId}" owns ` +
        `${domain}, and makes SSO routing for it publishable.\n`
    : `\nDRY RUN against ${projectId}. Nothing will be written. Pass ` +
        `--apply --confirm=${projectId} to write.\n`,
)

const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
const routing = await firestore.collection('ssoDomains').doc(domain).get()
const claimRef = firestore
  .collection('orgs')
  .doc(orgId)
  .collection('ssoDomains')
  .doc(domain)
const claim = await claimRef.get()

const plan = planAttestation(
  {
    orgExists: orgSnapshot.exists,
    orgName: orgSnapshot.get('name') ?? null,
    governedDomains: Array.isArray(orgSnapshot.get('sso')?.domains)
      ? orgSnapshot.get('sso').domains
      : [],
    routingOrgId: routing.exists ? (routing.get('orgId') ?? null) : null,
    claim: claim.exists ? claim.data() : null,
  },
  parsed,
)

console.log(`  org           : ${orgId} (${plan.orgName ?? orgSnapshot.get('name') ?? '(unnamed)'})`)
console.log(`  domain        : ${domain}`)
console.log(`  claim exists  : ${claim.exists}`)
console.log(`  verified      : ${claim.exists ? claim.get('verified') : '(none)'}`)
console.log(
  `  attestedBy    : ${claim.exists ? (claim.get('attestedBy') ?? '(none)') : '(none)'}`,
)
console.log(`  routing doc   : ${routing.exists ? routing.get('active') : '(none)'}`)

if (plan.action === 'refuse') {
  die(`${plan.message} [${plan.reason}]`)
}

for (const warning of plan.warnings) console.log(`\n  ⚠️  ${warning}`)

if (plan.alreadyAttested) {
  console.log(`\n  (already attested by ${plan.previousAttestedBy} — re-running is a no-op)`)
} else if (plan.previousAttestedBy) {
  console.log(`\n  ⚠️  replacing an existing attestation by ${plan.previousAttestedBy}`)
}

console.log(
  `\n  would write   : ${JSON.stringify(plan.write)} (merge, plus attestedAt=<server>)`,
)

if (!apply) {
  console.log(
    `\nDry run — nothing written. Re-run with --apply --confirm=${projectId}.\n`,
  )
  process.exit(0)
}

await claimRef.set(
  { ...plan.write, attestedAt: FieldValue.serverTimestamp() },
  // MERGE: never resets a token or a `verified` state this did not create.
  { merge: true },
)

// An out-of-band ownership assertion is exactly the sort of act that gets
// asked about months later, so it lands in the same audit collection as
// impersonation and the lockdown levers rather than only in this terminal.
await firestore.collection('adminAudit').add({
  actorUid: by,
  action: 'org.sso.attestDomain',
  target: `orgs/${orgId}/ssoDomains/${domain}`,
  reason: note,
  before: {
    claimExisted: plan.claimExisted,
    attestedBy: plan.previousAttestedBy,
  },
  after: { orgId, domain, attestedBy: by },
  at: FieldValue.serverTimestamp(),
})

console.log(
  `\n✓ Attested ${domain} for ${orgId}. ` +
    "Turn SSO on from the org's settings to publish routing again.\n",
)
