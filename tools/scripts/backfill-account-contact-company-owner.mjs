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

// Account contacts in the operator's own CRM: their company and their owner.
//
//   node tools/scripts/backfill-account-contact-company-owner.mjs --host=<marketingHostId>
//   node tools/scripts/backfill-account-contact-company-owner.mjs --host=<marketingHostId> --out=rows.csv
//   node tools/scripts/backfill-account-contact-company-owner.mjs --host=<marketingHostId> --write
//
// DRY RUN BY DEFAULT. `--write` writes. Credentials come from the root `.env`,
// as every backfill here reads them.
//
// ## Why (AGL-4230)
//
// A new account's contact on the marketing host was written straight through
// the data library's capture door, so the CRM never ran the two steps it runs
// for every other new contact: the link to the company at the email's
// business domain and the owner from the org's rules or the site's default
// owner. Sign-up now goes through the capture seam and gets both. This gives
// the contacts made before that the same two steps.
//
// ## What it does
//
// Reads every contact on the marketing host's organization whose facet for
// the host's consent group has the `account` source and an address at a
// business domain (not a public mailbox), and that has no company, no owner,
// or neither. For each, it runs the CRM's own steps, unchanged:
//
// - no company: `associateCompanyByDomain` links the one company visible at
//   the domain, or creates one only when the org's `crm.autoCreateCompanies`
//   is on, exactly as a capture would;
// - no owner: `assignOwnerForCapture` runs the org's rules, then the site's
//   default owner, and tells the new owner, exactly as a capture would.
//
// The dry run prints each row's planned company and owner, the way the two
// steps would decide them now, so the rows can be checked before anything
// is written.
//
// ## What it never does
//
// Change a company or an owner a contact already has, touch a contact
// without the `account` source, or touch a public-mailbox address. The
// sign-up canary's throwaway accounts are left out (sign-up no longer makes
// them contacts at all), and so are addresses on the operator's own domain
// (`--internal-domain=<domain>`) unless `--include-internal` is passed.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { loadRootEnv } from './lib/firestore-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-account-contact-company-owner',
  summary:
    "Give the marketing host's account contacts at a business domain their company and owner, " +
    'as sign-up now does. Writes with --write.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--write', key: 'write', describe: 'Write. Without it, a dry run.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'The marketing host id (PLATFORM_MARKETING_HOST_ID).' },
    { flag: '--out', key: 'out', value: 'string', describe: 'Also write the planned rows to this CSV file.' },
    { flag: '--internal-domain', key: 'internalDomain', value: 'string', describe: "The operator's own email domain, left out by default." },
    { flag: '--include-internal', key: 'includeInternal', describe: 'Include addresses on the internal domain.' },
  ],
})
const write = Boolean(args.write)

/**
 * Load the server libs through the workspace's path aliases. One loader for
 * every lib, so they share one module graph.
 */
let serverLibLoader
function loadServerLib(file) {
  if (!serverLibLoader) {
    const { paths } = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.base.json'), 'utf8')).compilerOptions
    const alias = {}
    for (const [key, [target]] of Object.entries(paths)) {
      const absolute = join(REPO_ROOT, target)
      if (key.endsWith('/*')) alias[key.slice(0, -1)] = absolute.slice(0, -1)
      else alias[key] = absolute
    }
    serverLibLoader = createJiti(import.meta.url, { alias, interopDefault: true })
  }
  return serverLibLoader.import(join(REPO_ROOT, file))
}

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

async function main() {
  loadRootEnv(REPO_ROOT)
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= process.env.FIREBASE_PROJECT_ID
  const hostId = String(args.host ?? process.env.PLATFORM_MARKETING_HOST_ID ?? '').trim()
  if (!hostId) {
    console.error('Name the marketing host: --host=<id> or PLATFORM_MARKETING_HOST_ID. NOTHING WAS WRITTEN.')
    process.exit(2)
  }

  const { default: firebaseAdmin } = await loadServerLib('libs/tenant/data/admin/src/lib/server/firebase-admin.ts')
  const crm = await loadServerLib('libs/aglyn/src/lib/app-utils/crm.ts')
  const { consentGroupForHost } = await loadServerLib('libs/aglyn/src/lib/app-utils/consent-groups.ts')
  const { readContactFacet } = await loadServerLib('libs/aglyn/src/lib/app-utils/contacts.ts')
  const { isSignupCanaryEmail } = await loadServerLib('libs/aglyn/src/lib/app-utils/health-report.ts')
  const internalDomain = String(args.internalDomain ?? '').trim().toLowerCase()
  const db = firebaseAdmin.app().firestore()
  const auth = firebaseAdmin.app().auth()

  const host = await db.collection('hosts').doc(hostId).get()
  const orgId = host.exists ? String(host.get('orgId') ?? '') : ''
  if (!orgId) {
    console.error(`Host ${hostId} has no organization. NOTHING WAS WRITTEN.`)
    process.exit(2)
  }
  const orgRef = db.collection('orgs').doc(orgId)
  const org = (await orgRef.get()).data() ?? {}
  const group = consentGroupForHost(org, hostId)
  const autoCreate = crm.orgAutoCreatesCompanies(org)
  const settings = crm.readCrmAssignmentSettings(org)

  // Who a uid is, for the rows a person reads.
  const people = new Map()
  async function personName(uid) {
    if (!uid) return ''
    if (!people.has(uid)) {
      // The roster first: an owner may live in an SSO tenant's pool, which
      // the project's own Auth lookup cannot see.
      const member = await orgRef.collection('members').doc(uid).get()
      const name =
        String(member.get('displayName') ?? '') ||
        (await auth
          .getUser(uid)
          .then((user) => user.displayName || user.email || uid)
          .catch(() => uid))
      people.set(uid, name)
    }
    return people.get(uid)
  }
  const roster = new Map()
  async function onRoster(uid) {
    if (!roster.has(uid)) roster.set(uid, (await orgRef.collection('members').doc(uid).get()).exists)
    return roster.get(uid)
  }

  // The owner the capture pass would pick now, with the rotation's pointer
  // moving between rows the way consecutive captures would move it.
  let pointer = settings.pool.lastAssignedUid
  async function plannedOwner(email) {
    const capture = { source: 'account', email, formId: null, tags: [] }
    for (const rule of settings.rules) {
      if (!crm.assignmentRuleMatches(rule.when, capture)) continue
      if ('roundRobin' in rule.assign) {
        for (const uid of crm.roundRobinOrder(settings.pool.memberUids, pointer)) {
          if (await onRoster(uid)) {
            pointer = uid
            return { uid, by: `rule ${rule.id} (round robin)` }
          }
        }
        continue
      }
      if (await onRoster(rule.assign.memberUid)) return { uid: rule.assign.memberUid, by: `rule ${rule.id}` }
    }
    const fallback = settings.hostDefaultOwners[hostId]
    if (fallback && (await onRoster(fallback))) return { uid: fallback, by: "site's default owner" }
    return null
  }

  const companiesRef = orgRef.collection(crm.CRM_COLLECTIONS.companies)
  const companyNames = new Map()
  async function plannedCompany(domain) {
    const matches = await companiesRef
      .where('domain', '==', domain)
      .where('visibleTo', 'array-contains-any', crm.crmReadTokens(group))
      .limit(2)
      .get()
    if (matches.size > 1) return { action: 'none', detail: `${matches.size}+ companies at ${domain}, ambiguous` }
    if (matches.size === 1) {
      const doc = matches.docs[0]
      companyNames.set(doc.id, String(doc.get('name') ?? ''))
      return { action: 'link', companyId: doc.id, detail: `${doc.get('name') ?? doc.id} (${doc.id})` }
    }
    const name = crm.companyNameForDomain(domain)
    return autoCreate
      ? { action: 'create', detail: `new company "${name}" (${domain})` }
      : { action: 'none', detail: `no company at ${domain}; would create "${name}" if auto-create were on` }
  }

  const rows = []
  let read = 0
  let notAccount = 0
  let publicMailbox = 0
  let canary = 0
  let internal = 0
  let complete = 0
  for (const doc of (await orgRef.collection('contacts').get()).docs) {
    read += 1
    const contact = doc.data() ?? {}
    const facet = readContactFacet(contact, group.groupId)
    if (!facet.sources || !Object.hasOwn(facet.sources, 'account')) {
      notAccount += 1
      continue
    }
    const email = String(contact.email ?? '').trim().toLowerCase()
    if (isSignupCanaryEmail(email)) {
      canary += 1
      continue
    }
    if (internalDomain && email.endsWith(`@${internalDomain}`) && !args.includeInternal) {
      internal += 1
      continue
    }
    const domain = crm.companyDomainForEmail(email)
    if (!domain) {
      publicMailbox += 1
      continue
    }
    const hasCompany = Boolean(facet.companyId)
    const hasOwner = Boolean(facet.ownerUid)
    if (hasCompany && hasOwner) {
      complete += 1
      continue
    }
    rows.push({
      contactId: doc.id,
      email,
      name: String(facet.name ?? contact.name ?? ''),
      domain,
      company: hasCompany ? { action: 'keep', detail: String(facet.companyName ?? facet.companyId) } : await plannedCompany(domain),
      owner: hasOwner ? { keep: true, uid: facet.ownerUid } : await plannedOwner(email),
    })
  }

  console.log(
    `Org ${orgId}, host ${hostId}, group ${group.groupId}. Auto-create companies: ${autoCreate ? 'ON' : 'off'}. ` +
      `Assignment rules: ${settings.rules.length}. Round-robin pool: ${settings.pool.memberUids.length}. ` +
      `Site default owner: ${settings.hostDefaultOwners[hostId] ? await personName(settings.hostDefaultOwners[hostId]) : 'none'}.`,
  )
  console.log(
    `Contacts read: ${read}. Not account contacts: ${notAccount}. Sign-up canary: ${canary}. ` +
      `Internal, left out: ${internal}. Public mailbox: ${publicMailbox}. ` +
      `Already have both: ${complete}. To fill: ${rows.length}.`,
  )
  const lines = ['contactId,email,name,company,owner']
  for (const row of rows) {
    const owner = row.owner?.keep
      ? `keep ${await personName(row.owner.uid)}`
      : row.owner
        ? `${await personName(row.owner.uid)} (${row.owner.by})`
        : 'nobody (no rule matches and the site has no default owner)'
    const company = `${row.company.action}: ${row.company.detail}`
    console.log(`  ${row.email}  ${row.name}\n      company ${company}\n      owner   ${owner}`)
    lines.push([row.contactId, row.email, row.name, company, owner].map(csvCell).join(','))
  }
  if (args.out) {
    writeFileSync(String(args.out), `${lines.join('\n')}\n`)
    console.log(`Rows written to ${args.out}`)
  }
  if (!write) {
    console.log('Dry run: nothing was written. Re-run with --write. Each owner assigned is notified once per contact.')
    return
  }

  const { associateCompanyByDomain } = await loadServerLib(
    'libs/plugins/crm/src/lib/server/associate-company-by-domain.ts',
  )
  const { assignOwnerForCapture } = await loadServerLib('libs/plugins/crm/src/lib/server/assign-contact-owner.ts')
  const outcomes = {}
  const count = (key) => {
    outcomes[key] = (outcomes[key] ?? 0) + 1
  }
  for (const row of rows) {
    if (row.company.action !== 'keep') {
      const linked = await associateCompanyByDomain({ hostId, contactId: row.contactId, email: row.email })
      count(`company:${linked.outcome}${linked.reason ? `:${linked.reason}` : ''}`)
    }
    if (!row.owner?.keep) {
      const assigned = await assignOwnerForCapture({
        hostId,
        contactId: row.contactId,
        email: row.email,
        source: 'account',
      })
      count(`owner:${assigned.outcome}${assigned.reason ? `:${assigned.reason}` : ''}`)
    }
  }
  console.log('Written:', JSON.stringify(outcomes))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
