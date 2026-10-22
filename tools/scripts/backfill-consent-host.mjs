/**
 * Gives every stored marketing-consent basis the HOST it was given to, and
 * closes the scope fail-open the same sweep depends on.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-consent-host.mjs \
 *     [--apply] [--org=<orgId>] [--host=<hostId>]
 *
 *   FIRESTORE_EMULATOR_HOST=… node tools/scripts/backfill-consent-host.mjs --self-test
 *
 * DRY RUN BY DEFAULT.
 *
 * ## What changed underneath the data
 *
 * `marketingConsent` was one boolean per person on an ORG-scoped record, so a
 * basis given to one brand made that person mailable by every brand in the
 * account. Consent now lives at `marketingConsentByHost.{hostId}` and
 * `readMarketingBasis` reads exactly that key. A top-level `true` therefore
 * grants to nobody — deliberately, because it names no controller — so every
 * record still carrying one is unmailable until this script says whose it is.
 *
 * `visibleTo` moved the same way: absent used to mean "every site" and now
 * means "no site", matching what Firestore's `array-contains-any` and the
 * rules' `hasAny` have always done with a missing field.
 *
 * ## THE ASSIGNMENT, AND WHERE IT REFUSES TO GUESS
 *
 * A basis goes to the host that CAPTURED the record, and to no other:
 *
 *  - `hosts/{hostId}/leads`, `hosts/{hostId}/siteMembers` — the path names
 *    the host. Unambiguous.
 *  - `orgs/{orgId}/contacts` — `upsertHostContact` has stamped `hostId` on
 *    every contact it created, documented as provenance. That field IS the
 *    capturing brand.
 *  - `orgs/{orgId}/lists/{listId}/members` — a list is org-shared and a
 *    membership stores no host. Assignable only when the owning org has
 *    exactly ONE host, in which case "the brand that captured them" has one
 *    possible value and no guess is being made.
 *
 * Anything else is REPORTED AND LEFT ALONE: a contact with no `hostId`, a
 * list membership under a multi-site org. The available guesses are all the
 * wrong shape — assigning every host in the org is the leak this change
 * exists to end, written by hand; assigning the first host is that same
 * assertion with a coin flip in front of it. An operator who knows which
 * brand a given list belongs to can run with `--host=` and `--org=` to say
 * so, which turns the guess into a statement somebody made.
 *
 * The 15 records the earlier `operator-backfill` wrote are ordinary input
 * here: their provenance travels with the basis into the host entry, so a
 * grant an operator asserted stays distinguishable from one a person gave.
 *
 * ## The BUSINESS RECORDS move into the capturing holder's facet
 *
 * `sources`, `interactions`, tags, notes and every commercial figure sat at
 * the TOP of a shared contact document, so every site in an agency's account
 * could read every client's notes and lifetime values. They move under
 * `facets.{hostId}` — the capturing site's, which is the only holder the
 * document names.
 *
 * ⛔ INTERACTIONS MOVE UNATTRIBUTED. Each one carries no host and none can be
 * derived: `hostId` names the FIRST capturing site and says nothing about
 * which site produced any particular visit. They are moved as they are, and
 * `interactionsForGroup` shows an unattributed visit to whoever holds the
 * facet rather than inventing a site for it.
 *
 * ## The two records it must never touch
 *
 *  - **`marketingConsent: false`.** A refusal, and it is deliberately left at
 *    the top level, where `readMarketingBasis` honors it against every host.
 *    A refusal recorded against nobody in particular is most safely honored
 *    against everybody, and narrowing one to a single brand here would put
 *    this person back in three other brands' audiences.
 *  - **An existing `marketingConsentByHost` entry for the same host.** It was
 *    written by a capture surface with the person in front of it; the
 *    top-level value is older and less specific.
 *
 * ## Why the `visibleTo` stamp is in the same script
 *
 * Because the consent phase reads through the same scope. A contact with no
 * `visibleTo` is now visible to no site, so a run that assigned its consent
 * and left it unscoped would produce a record that is correctly consented and
 * still cannot be mailed — a fix reported as complete and observable only as
 * an audience that is short. `['org']` is the stamp, matching
 * `apps/console/utils/server/backfill-scope.ts`, whose `needsScopeStamp` rule
 * this repeats: an EMPTY array is a written "visible to nobody" and is left
 * alone, because rewriting one would widen a resource somebody hid.
 *
 * ## Idempotence
 *
 * Every phase plans against what it reads, so a second run plans zero writes.
 * Each record is one `update`; interruption is safe and there is no second
 * phase to finish.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-consent-host',
  summary:
    'Move every marketing-consent basis under the host it was given to, and ' +
    'stamp the org-wide scope on records that carry none. Writes to the live ' +
    'project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the emulator fixtures.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org.' },
    {
      flag: '--host',
      key: 'host',
      value: 'string',
      describe:
        'The host to assign where the record does not name one. Only ever ' +
        'used for list memberships, and only with --org.',
    },
  ],
})

/** KEEP IN SYNC with `MARKETING_CONSENT_FIELD`. */
const CONSENT_FIELD = 'marketingConsent'
/** KEEP IN SYNC with `MARKETING_CONSENT_BY_HOST_FIELD`. */
const BY_HOST_FIELD = 'marketingConsentByHost'
/** KEEP IN SYNC with `CAPTURED_BY_HOST_FIELD`. An ARRAY. */
const CAPTURED_BY_FIELD = 'capturedByHostIds'
/** KEEP IN SYNC with `CONTACT_FACETS_FIELD`. */
const FACETS_FIELD = 'facets'
/** The fields that move off the top of a contact into its holder's facet. */
const FACET_FIELDS = [
  'sources',
  'interactions',
  'tags',
  'notes',
  'ltvCents',
  'ordersCount',
  'lastPurchaseAtMs',
  'firstPurchaseAtMs',
  'refundedCents',
  'refundedOrdersCount',
  'lastRefundAtMs',
]
/** KEEP IN SYNC with `ORG_SCOPE_TOKEN`. */
const ORG_SCOPE_TOKEN = 'org'

/**
 * The fields that travel WITH a basis into its host entry.
 *
 * Provenance is the reason this is a list and not just the boolean and its
 * date: a basis an operator asserted must stay distinguishable from one a
 * person gave, and a move that dropped `marketingConsentSource` would launder
 * all 15 backfilled records into apparent opt-ins.
 */
const BASIS_COMPANIONS = [
  'marketingConsentAtMs',
  'marketingConsentSource',
  'marketingConsentBasis',
  'marketingConsentByUid',
  'marketingConsentReason',
]

/** The collections whose documents carry `visibleTo`. */
const SCOPED_ORG_COLLECTIONS = [
  'datasets',
  'media',
  'mediaFolders',
  'contacts',
  'contactSegments',
]

/**
 * Every person record, with the host the assignment may use.
 *
 * `hostId` is `null` where the record does not name one — that null is the
 * refusal, carried rather than resolved, so the report can name what it could
 * not place instead of the sweep quietly skipping it.
 */
async function collectPeople(firestore, { onlyOrg, onlyHost, assignHost }) {
  const found = []
  const hosts = onlyHost
    ? [await firestore.collection('hosts').doc(onlyHost).get()]
    : (await firestore.collection('hosts').get()).docs
  for (const host of hosts) {
    if (!host.exists) continue
    for (const silo of ['leads', 'siteMembers']) {
      for (const doc of (await host.ref.collection(silo).get()).docs) {
        found.push({
          silo,
          ref: doc.ref,
          data: doc.data() ?? {},
          hostId: host.id,
        })
      }
    }
  }
  const orgs = onlyOrg
    ? [await firestore.collection('orgs').doc(onlyOrg).get()]
    : (await firestore.collection('orgs').get()).docs
  for (const org of orgs) {
    if (!org.exists) continue
    const orgHosts = Object.keys((org.data() ?? {}).hosts ?? {})
    /*
     * The one-host org is not a guess. When an organization owns exactly one
     * site, "the brand that captured this person" has one possible value, and
     * naming it is a statement of fact rather than a choice among brands.
     * `--host` overrides it for the operator who knows more than the data
     * does — and is refused below unless `--org` narrows the run, so one
     * person's answer about one list cannot be applied to a whole project.
     */
    const orgDefault =
      assignHost ?? (orgHosts.length === 1 ? orgHosts[0] : null)
    for (const doc of (await org.ref.collection('contacts').get()).docs) {
      const data = doc.data() ?? {}
      const stamped = Array.isArray(data[CAPTURED_BY_FIELD])
        ? data[CAPTURED_BY_FIELD][0]
        : data.hostId
      found.push({
        silo: 'contacts',
        ref: doc.ref,
        data,
        hostId: typeof stamped === 'string' && stamped ? stamped : null,
      })
    }
    for (const list of (await org.ref.collection('lists').get()).docs) {
      for (const doc of (await list.ref.collection('members').get()).docs) {
        const data = doc.data() ?? {}
        const stamped = Array.isArray(data[CAPTURED_BY_FIELD])
          ? data[CAPTURED_BY_FIELD][0]
          : undefined
        found.push({
          silo: 'listMembers',
          ref: doc.ref,
          data,
          hostId:
            typeof stamped === 'string' && stamped ? stamped : orgDefault,
        })
      }
    }
  }
  return found
}

/**
 * What one person record needs, as a verdict rather than an action, so the
 * dry run and the apply run cannot disagree about what was planned.
 *
 * The order matters: `declined` is answered first, so nothing later — a
 * missing host, an existing entry, a malformed neighbour field — can be the
 * reason a refusal was reconsidered.
 */
export function planPerson(record) {
  const data = record.data ?? {}
  if (data[CONSENT_FIELD] === false) {
    return { action: 'skip', why: 'declined' }
  }
  const byHost = data[BY_HOST_FIELD]
  const existing =
    byHost && typeof byHost === 'object' && !Array.isArray(byHost)
      ? byHost
      : null
  const needsCapture =
    !Array.isArray(data[CAPTURED_BY_FIELD]) && Boolean(record.hostId)
  if (data[CONSENT_FIELD] !== true) {
    return needsCapture
      ? { action: 'attribute', hostId: record.hostId }
      : { action: 'skip', why: 'no-basis' }
  }
  if (!record.hostId) return { action: 'skip', why: 'unassignable' }
  if (existing && existing[record.hostId]) {
    return { action: 'skip', why: 'already-scoped' }
  }
  return { action: 'move', hostId: record.hostId, needsCapture }
}

/**
 * The update for one planned move.
 *
 * DOTTED paths into the map, never a nested object: an `update` handed a
 * nested map REPLACES the field, so a nested write would delete every other
 * host's entry — the same over-application this migration removes, arriving
 * through the write side.
 *
 * The top-level basis is DELETED once it has a home. Left standing it reports
 * as an unattributed grant forever, which is a state this migration exists to
 * empty, and the console would show a person as consented-to-nobody beside
 * the host entry that actually decides their mail.
 */
export function movePatch(record, plan) {
  const data = record.data ?? {}
  const patch = {
    [`${BY_HOST_FIELD}.${plan.hostId}.${CONSENT_FIELD}`]: true,
    [CONSENT_FIELD]: FieldValue.delete(),
  }
  for (const field of BASIS_COMPANIONS) {
    if (data[field] === undefined) continue
    patch[`${BY_HOST_FIELD}.${plan.hostId}.${field}`] = data[field]
    patch[field] = FieldValue.delete()
  }
  if (plan.needsCapture) patch[CAPTURED_BY_FIELD] = [plan.hostId]
  Object.assign(patch, facetPatch(record, plan.hostId))
  return patch
}

/**
 * Moves a contact's top-level business records into the capturing holder's
 * facet.
 *
 * `sources`, `interactions`, the tags, the notes and every commercial figure
 * are the HOLDER's own — a note one client of an agency wrote about a person
 * is that client's — and while they sat at the top of a shared row every
 * other client could read them. The capturing site is the only holder that
 * can honestly be given them: nothing on the document says any other site
 * contributed, and inventing one would be attributing somebody's notes to a
 * business that never wrote them.
 *
 * ⛔ INTERACTIONS ARE MOVED UNATTRIBUTED. Each one carries no host and none
 * can be inferred: `hostId` names the FIRST capturing site and says nothing
 * about which site produced any particular visit. They keep no `hostId`, and
 * `interactionsForGroup` shows an unattributed visit to whoever holds the
 * facet rather than guessing.
 *
 * Only for `contacts`. The other three silos have no facet: leads and site
 * members live under one host by path, and a list membership carries a basis
 * and nothing else.
 */
function facetPatch(record, hostId) {
  if (record.silo !== 'contacts') return {}
  const data = record.data ?? {}
  // A facet already there is a row this migration has reached, or one written
  // by the current code. Either way it is not this script's to rewrite.
  const existing = data[FACETS_FIELD]
  if (existing && typeof existing === 'object' && existing[hostId]) return {}
  const patch = {}
  for (const field of FACET_FIELDS) {
    if (data[field] === undefined) continue
    patch[`${FACETS_FIELD}.${hostId}.${field}`] = data[field]
    patch[field] = FieldValue.delete()
  }
  return patch
}

/** Whether a scoped document still needs the org-wide stamp. */
export function needsScopeStamp(data) {
  return !Array.isArray((data ?? {}).visibleTo)
}

async function stampScopes(firestore, { write, onlyOrg }) {
  const tally = { stamped: 0, skipped: 0 }
  const orgs = onlyOrg
    ? [await firestore.collection('orgs').doc(onlyOrg).get()]
    : (await firestore.collection('orgs').get()).docs
  for (const org of orgs) {
    if (!org.exists) continue
    for (const name of SCOPED_ORG_COLLECTIONS) {
      for (const doc of (await org.ref.collection(name).get()).docs) {
        if (!needsScopeStamp(doc.data() ?? {})) {
          tally.skipped += 1
          continue
        }
        tally.stamped += 1
        if (write) await doc.ref.update({ visibleTo: [ORG_SCOPE_TOKEN] })
      }
    }
  }
  return tally
}

async function assignConsent(firestore, { write, onlyOrg, onlyHost, assignHost }) {
  const people = await collectPeople(firestore, { onlyOrg, onlyHost, assignHost })
  const tally = {
    moved: 0,
    attributed: 0,
    declined: 0,
    noBasis: 0,
    alreadyScoped: 0,
    unassignable: 0,
  }
  const unassignable = []
  for (const record of people) {
    const plan = planPerson(record)
    if (plan.action === 'move') {
      tally.moved += 1
      if (write) await record.ref.update(movePatch(record, plan))
      continue
    }
    if (plan.action === 'attribute') {
      tally.attributed += 1
      if (write) {
        await record.ref.update({ [CAPTURED_BY_FIELD]: plan.hostId })
      }
      continue
    }
    if (plan.why === 'declined') tally.declined += 1
    else if (plan.why === 'no-basis') tally.noBasis += 1
    else if (plan.why === 'already-scoped') tally.alreadyScoped += 1
    else {
      tally.unassignable += 1
      unassignable.push(`${record.silo} ${record.ref.path}`)
    }
  }
  return { tally, unassignable, total: people.length }
}

function report({ scopes, consent }, { write }) {
  const lines = [
    '',
    write ? '── WRITTEN ──' : '── DRY RUN — nothing was written ──',
    '',
    `visibleTo stamped        ${scopes.stamped}`,
    `visibleTo already set    ${scopes.skipped}`,
    '',
    `person records read      ${consent.total}`,
    `basis moved under a host ${consent.tally.moved}`,
    `capture host stamped     ${consent.tally.attributed}`,
    `already host-scoped      ${consent.tally.alreadyScoped}`,
    `refusals left alone      ${consent.tally.declined}`,
    `no basis to move         ${consent.tally.noBasis}`,
    `UNASSIGNABLE             ${consent.tally.unassignable}`,
  ]
  if (consent.unassignable.length) {
    lines.push(
      '',
      'These carry a basis that names no host, and none was guessed for',
      'them. Re-run with --org= and --host= to state which brand they',
      'belong to, or leave them: an unassigned basis grants to nobody.',
      ...consent.unassignable.map((path) => `  ${path}`),
    )
  }
  return lines.join('\n')
}

/**
 * Emulator fixtures for the four decisions that can go wrong, all of them in
 * the direction of mailing somebody who did not agree.
 */
async function runSelfTest(firestore) {
  const org = firestore.collection('orgs').doc('selftest-org')
  await org.set({ hosts: { 'host-a': true, 'host-b': true } })
  const contacts = org.collection('contacts')
  await contacts.doc('granted').set({
    email: 'granted@example.test',
    hostId: 'host-a',
    marketingConsent: true,
    marketingConsentAtMs: 1,
    marketingConsentSource: { kind: 'operator-backfill', by: 'ops', atMs: 1 },
    visibleTo: [ORG_SCOPE_TOKEN],
    tags: ['vip'],
    notes: 'Called about the leak.',
    ltvCents: 5000,
    interactions: [{ type: 'form', atMs: 1 }],
  })
  await contacts.doc('declined').set({
    email: 'declined@example.test',
    hostId: 'host-a',
    marketingConsent: false,
    visibleTo: [ORG_SCOPE_TOKEN],
  })
  await contacts.doc('hostless').set({
    email: 'hostless@example.test',
    marketingConsent: true,
    visibleTo: [ORG_SCOPE_TOKEN],
  })
  await contacts.doc('unscoped').set({
    email: 'unscoped@example.test',
    hostId: 'host-a',
  })

  const scopes = await stampScopes(firestore, { write: true, onlyOrg: 'selftest-org' })
  const consent = await assignConsent(firestore, {
    write: true,
    onlyOrg: 'selftest-org',
    onlyHost: null,
    assignHost: null,
  })

  const failures = []
  const granted = (await contacts.doc('granted').get()).data()
  if (granted[BY_HOST_FIELD]?.['host-a']?.[CONSENT_FIELD] !== true) {
    failures.push('a grant did not land under its capturing host')
  }
  if (granted[BY_HOST_FIELD]?.['host-b']) {
    failures.push('a grant reached a host that did not capture the person')
  }
  if (granted[CONSENT_FIELD] !== undefined) {
    failures.push('the unscoped grant survived the move')
  }
  if (
    granted[BY_HOST_FIELD]?.['host-a']?.marketingConsentSource?.kind !==
    'operator-backfill'
  ) {
    failures.push('provenance was lost, laundering an assertion into an opt-in')
  }
  const declined = (await contacts.doc('declined').get()).data()
  if (declined[CONSENT_FIELD] !== false) {
    failures.push('a refusal was moved or removed')
  }
  const hostless = (await contacts.doc('hostless').get()).data()
  if (hostless[CONSENT_FIELD] !== true || hostless[BY_HOST_FIELD]) {
    failures.push('an unassignable basis was assigned anyway')
  }
  if (consent.tally.unassignable !== 1) {
    failures.push('the unassignable record was not reported')
  }
  if (granted[FACETS_FIELD]?.['host-a']?.notes !== 'Called about the leak.') {
    failures.push('business records did not move into the capturing facet')
  }
  if (granted.notes !== undefined || granted.tags !== undefined) {
    failures.push('business records were left readable at the top of the row')
  }
  if (granted[FACETS_FIELD]?.['host-a']?.interactions?.[0]?.hostId) {
    failures.push('an interaction was attributed to a site by guesswork')
  }
  const unscoped = (await contacts.doc('unscoped').get()).data()
  if (unscoped.visibleTo?.[0] !== ORG_SCOPE_TOKEN) {
    failures.push('an unscoped document was left invisible to every site')
  }
  if (scopes.stamped !== 1) failures.push('the scope stamp count is wrong')

  // Idempotence: a second run plans nothing.
  const second = await assignConsent(firestore, {
    write: false,
    onlyOrg: 'selftest-org',
    onlyHost: null,
    assignHost: null,
  })
  if (second.tally.moved !== 0) failures.push('a second run would move again')

  return failures
}

const apply = args.apply
const onlyOrg = args.org ?? null
const onlyHost = args.host ?? null

if (onlyHost && !onlyOrg) {
  console.error(
    '--host names the brand to assign a hostless record to, and that answer ' +
      'is about ONE organization. Pass --org with it.\n\nNOTHING WAS WRITTEN.',
  )
  process.exit(2)
}

initializeApp(
  process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() },
)
const firestore = getFirestore()

if (args.selfTest) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('--self-test needs FIRESTORE_EMULATOR_HOST.\n\nNOTHING WAS WRITTEN.')
    process.exit(2)
  }
  const failures = await runSelfTest(firestore)
  if (failures.length) {
    console.error(failures.map((line) => `  ✗ ${line}`).join('\n'))
    process.exit(2)
  }
  console.log('  ✓ self-test passed')
  process.exit(0)
}

const scopes = await stampScopes(firestore, { write: apply, onlyOrg })
const consent = await assignConsent(firestore, {
  write: apply,
  onlyOrg,
  onlyHost,
  assignHost: onlyHost,
})
console.log(report({ scopes, consent }, { write: apply }))
process.exit(0)
