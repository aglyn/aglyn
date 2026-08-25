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
// AGL-1887 gave the attestation a representation the publish path recognises:
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
// put the evidence in --note. Your uid goes on the record.
//
// The safe alternative, whenever it is available, is to have the customer
// publish the DNS TXT challenge and use the normal Verify button. That proves
// ownership rather than asserting it, and it needs no staff at all.
//
// Dry-run by default: it prints exactly what it would write and touches
// nothing. Pass --commit to apply. Idempotent — re-attesting the same domain
// rewrites the same marker, and the write MERGES, so a claim already midway
// through DNS verification keeps its token and its `verified` state.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/attest-sso-domain.mjs \
//       --org aglyn-org --domain aglyn.com --by <staff-uid> \
//       --note 'Onboarded by hand 2026-07; ownership confirmed via …' [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

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

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i !== -1 ? String(args[i + 1] ?? '') : fallback
}

const COMMIT = flag('--commit')
const ORG_ID = opt('--org').trim()
const RAW_DOMAIN = opt('--domain').trim()
const BY = opt('--by').trim()
const NOTE = opt('--note').trim()

// MUST match `normalizeSsoDomain` in sso-provisioning.ts. The claim document is
// keyed by the domain, so a different spelling here writes a marker at a path
// the publish path will never read — which presents as "I attested it and it
// still will not turn on".
const normalizeSsoDomain = (input) => {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  const at = raw.lastIndexOf('@')
  return (at >= 0 ? raw.slice(at + 1) : raw).replace(/^@+/, '').replace(/\.$/, '')
}
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/

const die = (message) => {
  console.error(`!! ${message}`)
  process.exit(1)
}

const domain = normalizeSsoDomain(RAW_DOMAIN)
if (!ORG_ID) die('Missing --org <orgId>')
if (!domain || !DOMAIN_PATTERN.test(domain)) die('Missing or invalid --domain')
// Required, and it is the whole point of the record: an attestation that does
// not say who made it is not attributable to anybody.
if (!BY) die('Missing --by <staff-uid> — an attestation records who made it')
if (!NOTE) {
  die(
    'Missing --note — say how ownership was confirmed. This is the only ' +
      'record of why a domain was published without DNS proof.',
  )
}

const projectId = process.env.FIREBASE_PROJECT_ID
if (!projectId) die('Missing FIREBASE_PROJECT_ID env var')
if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    die('Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `\nAttest SSO domain — project=${projectId} org=${ORG_ID} ` +
    `domain=${domain} by=${BY} mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

const orgSnapshot = await firestore.collection('orgs').doc(ORG_ID).get()
if (!orgSnapshot.exists) die(`No such organization: ${ORG_ID}`)

// The same uniqueness rule `issueDomainClaim` and `attestSsoDomain` enforce.
// An attestation must not be a way around "one domain, one org" — a conflict
// is for a human to resolve before anything is written, not for whoever
// attests last to win.
const routing = await firestore.collection('ssoDomains').doc(domain).get()
if (routing.exists && routing.get('orgId') !== ORG_ID) {
  die(
    `${domain} is already routed to org "${routing.get('orgId')}". ` +
      'Resolve that before attesting.',
  )
}

const claimRef = firestore
  .collection('orgs')
  .doc(ORG_ID)
  .collection('ssoDomains')
  .doc(domain)
const claim = await claimRef.get()

console.log(`  org name      : ${orgSnapshot.get('name') ?? '(unnamed)'}`)
console.log(`  claim exists  : ${claim.exists}`)
console.log(`  verified      : ${claim.exists ? claim.get('verified') : '(none)'}`)
console.log(
  `  attestedBy    : ${claim.exists ? (claim.get('attestedBy') ?? '(none)') : '(none)'}`,
)
console.log(`  routing doc   : ${routing.exists ? routing.get('active') : '(none)'}`)

// The attestation is only HALF of what `activate` consults. The route reads
// the org's `sso.domains` array and hands THAT list to `publishSsoDomains`, so
// a domain the array does not name is never offered to the gate at all and the
// marker sits there doing nothing. Every pre-self-serve org is already in the
// array — that is how they are live — so this is a warning rather than a
// refusal, but it is the difference between "attested and it worked" and
// "attested and Turn on still says no".
const governed = Array.isArray(orgSnapshot.get('sso')?.domains)
  ? orgSnapshot.get('sso').domains
  : []
const isGoverned = governed.includes(domain)
console.log(`  in sso.domains: ${isGoverned}`)
if (!isGoverned) {
  console.log(
    `\n  ⚠️  ${domain} is NOT in this org's sso.domains ${JSON.stringify(governed)}.\n` +
      '     `activate` publishes only what that array names, so this\n' +
      '     attestation alone will not make Turn on work. Add the domain\n' +
      '     through the console (Set up DNS proof → verify), or confirm with\n' +
      '     whoever owns this org why it is missing, before relying on this.',
  )
}

console.log(`\n  would write   : attestedBy=${BY}, attestedAt=<server>, note=${NOTE}`)

if (!COMMIT) {
  console.log('\nDry run — nothing written. Re-run with --commit to apply.\n')
  process.exit(0)
}

await claimRef.set(
  {
    domain,
    attestedBy: BY,
    attestedAt: FieldValue.serverTimestamp(),
    attestationNote: NOTE,
  },
  // MERGE: never resets a token or a `verified` state this did not create.
  { merge: true },
)

// An out-of-band ownership assertion is exactly the sort of act that gets
// asked about months later, so it lands in the same audit collection as
// impersonation and the lockdown levers rather than only in this terminal.
await firestore.collection('adminAudit').add({
  actorUid: BY,
  action: 'org.sso.attestDomain',
  target: `orgs/${ORG_ID}/ssoDomains/${domain}`,
  reason: NOTE,
  before: {
    claimExisted: claim.exists,
    attestedBy: claim.exists ? (claim.get('attestedBy') ?? null) : null,
  },
  after: { orgId: ORG_ID, domain, attestedBy: BY },
  at: FieldValue.serverTimestamp(),
})

console.log(
  `\n✓ Attested ${domain} for ${ORG_ID}. ` +
    'Turn SSO on from the org\'s settings to publish routing again.\n',
)
