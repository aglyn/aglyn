/**
 * Marketing-consent basis backfill over the pre-release record set.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=… node tools/scripts/backfill-marketing-consent.mjs \
 *     [--apply] [--operator=<who>] [--reason=<why>] [--org=<orgId>] \
 *     [--host=<hostId>] [--exclude=<email,email>] [--max-records=<n>]
 *
 *   FIRESTORE_EMULATOR_HOST=… node tools/scripts/backfill-marketing-consent.mjs --self-test
 *
 * DRY RUN BY DEFAULT.
 *
 * Gives every existing person record a recorded marketing-consent basis, so
 * that `mode: 'strict'` — which needs one from everybody and grandfathers
 * nobody — does not withhold the entire audience the moment it is switched
 * on. The four silos are the ones `sweepAudience` in
 * `libs/plugins/marketing/src/lib/server/campaign-send.ts` actually reads:
 *
 *   hosts/{hostId}/leads              the `leads` audience
 *   hosts/{hostId}/siteMembers        the `members` audience
 *   orgs/{orgId}/contacts             the `segment` audience
 *   orgs/{orgId}/lists/{listId}/members   the `list` audience
 *
 * Read from that function rather than from the collection names that sound
 * right: `hosts/{hostId}/members` also exists and is org staff, not an
 * audience, and a backfill that asserted consent for it would be writing a
 * marketing basis onto people who are not marketing recipients at all.
 *
 * ## ⛔ What this script is asserting, and why that is only honest here
 *
 * Every write says a person agreed to receive marketing. That claim is
 * defensible over this data because the data is seed, demo and end-to-end
 * test fixtures belonging to a product with no billing customers — and it
 * stops being defensible the moment that is no longer true, which is why the
 * ceiling and the billing check below are refusals rather than warnings.
 *
 * It follows that a backfilled basis must NOT be written as though a person
 * gave it. `marketingConsent: true` and a date are exactly what a real
 * opt-in looks like, so a record carrying only those two fields is
 * indistinguishable from one somebody ticked a box for, and the audit trail
 * that makes consent evidence at all is gone. Every write therefore also
 * stamps `marketingConsentSource` — kind, operator, timestamp, reason — and
 * `readMarketingBasis` reports it back as `assertedBy: 'operator'`, so the
 * distinction survives into every surface that reads consent rather than
 * living only in whoever remembers this script ran.
 *
 * ## The two records it must never touch
 *
 *  * **`declined`.** A stored refusal is a decision a person made, and no
 *    backfill may mail over it. There is no flag for this and no ceiling
 *    under which it relaxes.
 *  * **`granted`.** Already carries a real basis, and its timestamp is the
 *    evidence for it. Restamping would replace a date somebody earned with
 *    the date a script ran.
 *
 * Both are decided twice: once in {@link planFor} for the report, and again
 * inside the transaction that writes, against a fresh read. The second check
 * is not redundant — a sweep of every silo is not instantaneous, and the
 * window between reading a record and writing it is exactly long enough for
 * somebody to click unsubscribe. Losing that race must not cost them their
 * refusal.
 *
 * A `marketingConsent` that is present but not a boolean is skipped too,
 * rather than normalized to `true`. An unrecognized stored value might be a
 * refusal written in a spelling this script does not know, and overwriting
 * it to find out is the one experiment that cannot be undone.
 *
 * ## The preconditions `--apply` can SEE
 *
 * Refusals, not prompts, and each reads something rather than being told it:
 *
 *  1. **No org is actually billing.** The premise is "pre-release, no real
 *     customers", and the machine-checkable form of that is the same rule
 *     `isBillingSubscription` uses for MRR: a paid plan AND a live Stripe
 *     subscription status. A staff plan override writes `plan` and no
 *     subscription, so comped and dark-launched orgs correctly do not count
 *     as customers — using the revenue rule rather than inventing one keeps
 *     this from reading `plan: 'enterprise'` on an internal org as a
 *     customer and refusing forever.
 *  2. **A record ceiling.** Seed and fixture data is tens of records; an
 *     audience worth asserting consent over is thousands. Crossing the
 *     ceiling does not mean the run is wrong, it means the premise this
 *     script was authorized under has expired — so `--max-records` may only
 *     LOWER it. Raising it is a decision about whose consent is being
 *     asserted, and that belongs in a diff somebody signed, not in a flag.
 *  3. **The reader understands the provenance.** `marketingConsent.ts` in
 *     this working tree must actually read {@link SOURCE_FIELD}. Writing
 *     provenance that nothing reads produces records that are, everywhere in
 *     the product, identical to real opt-ins — the exact outcome the field
 *     exists to prevent — and it would be silent. Checked against the source
 *     with comments stripped, because a guard on an irreversible write must
 *     not be answerable by prose that merely discusses the field.
 *  4. **An operator is named.** `by` cannot be blank: a basis attributed to
 *     nobody is not attributable, and the script has no way to invent one.
 *     Taken from `--operator=`, `AGLYN_BACKFILL_OPERATOR`, or the service
 *     account's own address when one is in use.
 *
 * ## What is REPORTED rather than refused
 *
 * Addresses whose domain is not obviously a fixture domain are listed under
 * "not obviously seed data", because a domain is a guess and an irreversible
 * write should not hang on one — and because the real ones include the
 * operators' own addresses, so refusing on it would make the precondition
 * unsatisfiable rather than safe. `--exclude=` drops named addresses from
 * the run for when that list turns up somebody who should not be in it.
 *
 * ## Idempotence
 *
 * A second run finds every record it wrote already `granted` and skips it,
 * reported separately from a person's own grant so that "already backfilled"
 * and "already consented" never blur into one number. Interruption is safe:
 * each record is one transaction and there is no second phase to finish.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

/*
 * ARGUMENTS FAIL CLOSED, for the same reason the deploys do (AGL-1489) and
 * with a sharper consequence.
 *
 * Scanning argv for known flags and ignoring the rest means a TYPO IS SILENT:
 * `--exlude=someone@example.com` is discarded, the run proceeds with no
 * exclusion, and the operator reads a report of a job they believe they
 * scoped. Here that writes `marketingConsent: true` onto the record of a real
 * person who never agreed to anything — the one outcome this script exists to
 * be careful about — and it is unrecoverable in the sense that matters, since
 * the false basis is indistinguishable from a real one to everything
 * downstream that reads it.
 *
 * So an unrecognized argument exits 2 having written nothing, and `--help`
 * prints usage instead of sweeping a live project.
 */
const args = parseDeployArgs({
  command: 'backfill-marketing-consent',
  summary:
    'Record an operator-attested marketing-consent basis on person records ' +
    'that carry none. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the emulator fixtures.' },
    { flag: '--operator', key: 'operator', value: 'string', describe: 'Who attests the basis.' },
    { flag: '--reason', key: 'reason', value: 'string', describe: 'Why, recorded on every record.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one org.' },
    { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one host.' },
    { flag: '--exclude', key: 'exclude', value: 'string', describe: 'Comma-separated addresses to leave alone.' },
    { flag: '--max-records', key: 'maxRecords', value: 'string', describe: 'Lower the record ceiling.' },
  ],
})
const apply = args.apply
const selfTest = args.selfTest
const flag = (name) =>
  args[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null
const onlyOrg = flag('org')
const onlyHost = flag('host')

/** The document field the basis itself lives on. */
const CONSENT_FIELD = 'marketingConsent'
/** Its timestamp, in epoch millis. */
const CONSENT_AT_FIELD = 'marketingConsentAtMs'
/**
 * The provenance field. KEEP IN SYNC with
 * `MARKETING_CONSENT_SOURCE_FIELD` in
 * `libs/aglyn/src/lib/app-utils/marketing-consent.ts` — a .mjs script cannot
 * import the TS module, which is why {@link readerUnderstandsProvenance}
 * checks that the two spellings still agree instead of trusting them to.
 */
const SOURCE_FIELD = 'marketingConsentSource'
/** KEEP IN SYNC with `OPERATOR_BACKFILL_CONSENT_KIND` in the same module. */
const SOURCE_KIND = 'operator-backfill'

const CONSENT_MODULE = join(
  REPO_ROOT,
  'libs',
  'aglyn',
  'src',
  'lib',
  'app-utils',
  'marketing-consent.ts',
)

/**
 * The premise ceiling. See precondition 2: `--max-records` may lower this
 * and may not raise it.
 */
const MAX_RECORDS = 500

const DEFAULT_REASON =
  'Pre-release backfill over seed, demo and end-to-end test records: the ' +
  'product has no billing customers, and strict-mode consent enforcement ' +
  'would otherwise withhold every existing address for want of a basis.'

/**
 * Domains that are fixtures by construction. Used ONLY to decide what the
 * report calls out for a human to look at — never to decide a write. RFC 2606
 * reserves the first four; the rest are this product's own.
 */
const SEED_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'test',
  'localhost',
  'invalid',
])
const SEED_DOMAIN_SUFFIXES = ['.test', '.example', '.invalid', '.localhost']

/** Matches the send path's own validation, so the two agree on who is a recipient. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Stripe statuses that mean the subscription is not owed. Mirrors `plan-entitlements.ts`. */
const DEAD_SUBSCRIPTION_STATUSES = new Set([
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
])

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase()

const domainOf = (email) => normalizeEmail(email).split('@')[1] ?? ''

/** Whether an address is a fixture by its domain alone. Report-only — see the header. */
function looksLikeSeedAddress(email) {
  const domain = domainOf(email)
  if (!domain) return true
  if (SEED_DOMAINS.has(domain)) return true
  return SEED_DOMAIN_SUFFIXES.some((suffix) => domain.endsWith(suffix))
}

/**
 * Comments out, code and strings intact — a scanner, not two regexes.
 *
 * Carried from `backfill-theme-history.mjs` for the same reason it exists
 * there: a `//` comment containing `/*` opens a block comment inside a line
 * comment under a block-first strip, which silently swallows the code the
 * guard is trying to read and reports a perfectly good file as missing the
 * name. Since what is at stake is whether an irreversible run may proceed,
 * the parse is exact rather than approximately right.
 */
function stripComments(source) {
  let out = ''
  let mode = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        i += 1
      } else if (char === '/' && next === '*') {
        mode = 'block'
        i += 1
      } else {
        if (char === "'" || char === '"' || char === '`') {
          mode = 'string'
          quote = char
        }
        out += char
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      } else if (char === '\n') out += char
    } else {
      out += char
      if (char === '\\') {
        out += next ?? ''
        i += 1
      } else if (char === quote) mode = 'code'
    }
  }
  return out
}

/**
 * PRECONDITION 3 — the consent reader in this tree actually reads the
 * provenance this script writes.
 *
 * Both the field name and the kind have to appear in live code, and
 * `assertedBy` has to be something the reader produces: name the field but
 * never surface whose act it was and the records are still, to every
 * consumer, ordinary opt-ins. Comments are stripped first because the cheap
 * version of this check is satisfied by a docstring that merely mentions the
 * field, and a docstring cannot make a reader read anything.
 *
 * Takes the source rather than only reading it so the self-test can hold the
 * property against texts it stages; production passes nothing.
 */
function readerUnderstandsProvenance(moduleSource) {
  const source = stripComments(
    moduleSource ?? readFileSync(CONSENT_MODULE, 'utf8'),
  )
  const missing = [
    [SOURCE_FIELD, source.includes(SOURCE_FIELD)],
    [SOURCE_KIND, source.includes(SOURCE_KIND)],
    ['assertedBy', source.includes('assertedBy')],
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name)
  return {
    ok: missing.length === 0,
    why: missing.length
      ? `\`${missing.join('`, `')}\` appear(s) in no live code in ${CONSENT_MODULE}`
      : 'the consent reader surfaces an operator-asserted basis',
  }
}

/**
 * PRECONDITION 1 — nobody is paying for this product yet.
 *
 * The same test `isBillingSubscription` applies for MRR: a plan that is not
 * free AND a subscription status Stripe still considers live. The status is
 * looked for on the org mirror and in `orgs/{orgId}/billing/stripe`, because
 * AGL-1028 moved the subscription there and left `billingStatus` behind as a
 * mirror — reading only one of the two would let a real customer through the
 * check that exists to catch exactly that.
 */
async function billingCustomers(firestore) {
  const orgs = onlyOrg
    ? [await firestore.collection('orgs').doc(onlyOrg).get()]
    : (await firestore.collection('orgs').get()).docs
  const paying = []
  for (const org of orgs) {
    if (!org.exists) continue
    const plan = org.get('plan')
    if (!plan || plan === 'free') continue
    const stripe = await org.ref.collection('billing').doc('stripe').get()
    const status =
      org.get('billingStatus') ??
      org.get('subscription')?.status ??
      (stripe.exists ? stripe.get('subscription')?.status : undefined)
    if (typeof status !== 'string' || !status) continue
    if (DEAD_SUBSCRIPTION_STATUSES.has(status)) continue
    paying.push({ id: org.id, name: org.get('name') ?? '', plan, status })
  }
  return paying
}

/**
 * Every person record the send path can reach, as `{ silo, ref, data }`.
 *
 * Explicit paths rather than a collection group: `members` is the name of
 * both a list's enrollment collection and a host's STAFF collection, and a
 * collection-group sweep would quietly assert marketing consent over the
 * second one.
 */
async function collectRecords(firestore) {
  const found = []
  const hosts = onlyHost
    ? [await firestore.collection('hosts').doc(onlyHost).get()]
    : (await firestore.collection('hosts').get()).docs
  for (const host of hosts) {
    if (!host.exists) continue
    for (const silo of ['leads', 'siteMembers']) {
      for (const doc of (await host.ref.collection(silo).get()).docs) {
        found.push({ silo, ref: doc.ref, data: doc.data() ?? {} })
      }
    }
  }
  const orgs = onlyOrg
    ? [await firestore.collection('orgs').doc(onlyOrg).get()]
    : (await firestore.collection('orgs').get()).docs
  for (const org of orgs) {
    if (!org.exists) continue
    for (const doc of (await org.ref.collection('contacts').get()).docs) {
      found.push({ silo: 'contacts', ref: doc.ref, data: doc.data() ?? {} })
    }
    for (const list of (await org.ref.collection('lists').get()).docs) {
      for (const doc of (await list.ref.collection('members').get()).docs) {
        found.push({
          silo: 'listMembers',
          ref: doc.ref,
          data: doc.data() ?? {},
        })
      }
    }
  }
  return found
}

export const SILOS = ['leads', 'siteMembers', 'contacts', 'listMembers']

/**
 * What one record needs, as a verdict rather than an action, so the dry run
 * and the apply run cannot disagree about what was planned.
 *
 * The order matters: `declined` is answered before anything else can be, so
 * no later condition — an exclusion, a missing address, a malformed
 * neighbour field — can ever be the reason a refusal was reconsidered.
 */
function planFor(data, { excluded }) {
  const consent = data?.[CONSENT_FIELD]
  if (consent === false) return { action: 'skip', why: 'declined' }
  if (consent === true) {
    return data?.[SOURCE_FIELD]?.kind === SOURCE_KIND
      ? { action: 'skip', why: 'already backfilled' }
      : { action: 'skip', why: 'already granted' }
  }
  if (consent !== undefined && consent !== null) {
    return { action: 'skip', why: 'malformed consent value' }
  }
  const email = normalizeEmail(data?.['email'])
  if (!email || !EMAIL_PATTERN.test(email)) {
    // No recipient, so no consent to assert. `sweepAudience` drops these too,
    // so a basis here would be a claim about nobody.
    return { action: 'skip', why: 'no usable address' }
  }
  if (excluded.has(email)) return { action: 'skip', why: 'excluded' }
  return { action: 'grant', why: 'no basis recorded', email }
}

/** The fields one grant writes. Built once so the report and the write agree. */
function grantPatch({ operator, reason, atMs }) {
  return {
    [CONSENT_FIELD]: true,
    [CONSENT_AT_FIELD]: atMs,
    [SOURCE_FIELD]: { kind: SOURCE_KIND, by: operator, atMs, reason },
  }
}

/**
 * `tamper` is a seam and it exists for one reason: the transaction's re-read
 * is the only thing standing between this script and mailing over a refusal
 * somebody recorded while the sweep was still running, and a guard nothing
 * can make fire is a guard nobody can prove is still there. Removing the
 * re-read leaves every other assertion in the self-test green — which was
 * measured, not assumed. The self-test passes a `tamper` that flips a record
 * to `declined` after it is planned and before it is written; production
 * never passes one.
 */
async function backfill(firestore, { write, operator, reason, excluded, tamper, atMs }) {
  const records = await collectRecords(firestore)
  const tally = {}
  for (const silo of SILOS) {
    tally[silo] = { total: 0, granted: 0, skipped: {} }
  }
  const notSeed = []
  const wrote = []

  for (const record of records) {
    const counts = tally[record.silo]
    counts.total += 1
    const plan = planFor(record.data, { excluded })
    if (plan.action !== 'grant') {
      counts.skipped[plan.why] = (counts.skipped[plan.why] ?? 0) + 1
      continue
    }
    counts.granted += 1
    if (!looksLikeSeedAddress(plan.email)) {
      notSeed.push({
        silo: record.silo,
        path: record.ref.path,
        email: plan.email,
        name: record.data?.['name'] ?? record.data?.['displayName'] ?? '',
      })
    }
    if (!write) continue

    if (tamper) await tamper(record.ref)
    /*
     * Re-decided against a FRESH read inside the transaction. The plan above
     * came from a sweep that may have started minutes ago, and the two
     * records this script must never touch are exactly the two a person can
     * create in that window by unsubscribing or by opting in. A transaction
     * makes the read that decides and the write that follows the same
     * instant, so the decision cannot be made against a record that no longer
     * says what it said.
     */
    const outcome = await firestore.runTransaction(async (tx) => {
      const fresh = await tx.get(record.ref)
      if (!fresh.exists) return 'vanished'
      const now = planFor(fresh.data() ?? {}, { excluded })
      if (now.action !== 'grant') return now.why
      tx.update(record.ref, grantPatch({ operator, reason, atMs }))
      return 'granted'
    })
    if (outcome === 'granted') {
      wrote.push(record.ref.path)
    } else {
      // The plan is corrected rather than kept: the report must say what
      // happened, not what was going to.
      counts.granted -= 1
      counts.skipped[`${outcome} (changed under the sweep)`] =
        (counts.skipped[`${outcome} (changed under the sweep)`] ?? 0) + 1
    }
  }
  return { tally, notSeed, wrote, total: records.length }
}

function report({ tally, notSeed, total }, { write, operator, reason }) {
  console.log(
    `\n${write ? 'APPLIED' : 'DRY RUN — nothing was written'}\n` +
      `  operator: ${operator}\n  reason:   ${reason}\n`,
  )
  console.log(
    '  silo'.padEnd(16) +
      'records'.padStart(9) +
      'grant'.padStart(8) +
      '   skipped',
  )
  let granted = 0
  for (const silo of SILOS) {
    const counts = tally[silo]
    granted += counts.granted
    const skipped = Object.entries(counts.skipped)
      .map(([why, n]) => `${n} ${why}`)
      .join(', ')
    console.log(
      `  ${silo}`.padEnd(16) +
        String(counts.total).padStart(9) +
        String(counts.granted).padStart(8) +
        `   ${skipped || '—'}`,
    )
  }
  console.log(`\n  ${total} records swept, ${granted} ${write ? 'given' : 'need'} a basis\n`)

  if (notSeed.length) {
    console.log(
      `  ⚠️  ${notSeed.length} of them are NOT on an obviously-seed domain. A\n` +
        `      basis is being asserted for these on the operator's word alone —\n` +
        `      read them, and pass --exclude= for any that is a real person:\n`,
    )
    for (const row of notSeed) {
      console.log(
        `      ${row.email.padEnd(34)} ${String(row.name).padEnd(24)} ${row.path}`,
      )
    }
    console.log('')
  } else {
    console.log('  every record needing a basis is on a fixture domain.\n')
  }
}

// ---------------------------------------------------------------- self-test
/**
 * Runs the real `backfill` against the emulator over fixtures staging every
 * state this script can meet, including the two it must refuse to damage.
 *
 * Every case asserts the OUTCOME of a real run, not the shape of a plan — a
 * test that only checked `planFor` would pass against a `backfill` that
 * wrote nothing at all, and against one that wrote over everything.
 */
async function runSelfTest(firestore) {
  const failures = []
  const check = (label, condition, detail = '') => {
    if (condition) console.log(`  ✓ ${label}`)
    else {
      console.log(`  ✗ ${label} ${detail}`)
      failures.push(label)
    }
  }
  const OPERATOR = 'operator@aglyn.com'
  const REASON = 'self-test'
  const AT = 1_700_000_000_000
  const run = (over = {}) =>
    backfill(firestore, {
      write: false,
      operator: OPERATOR,
      reason: REASON,
      excluded: new Set(),
      atMs: AT,
      ...over,
    })

  /**
   * HERMETIC. Run twice against one emulator and the second run inherits the
   * first run's records — already `granted` — so every CONTROL comes back
   * zero for a reason that has nothing to do with the code under test.
   */
  const wipe = async () => {
    for (const root of ['hosts', 'orgs']) {
      for (const doc of (await firestore.collection(root).get()).docs) {
        for (const sub of await doc.ref.listCollections()) {
          for (const child of (await sub.get()).docs) {
            for (const grand of await child.ref.listCollections()) {
              for (const leaf of (await grand.get()).docs) await leaf.ref.delete()
            }
            await child.ref.delete()
          }
        }
        await doc.ref.delete()
      }
    }
  }

  const PEOPLE = {
    // one per silo, so a sweep that forgets a silo cannot pass
    'hosts/h1/leads/lead-blank': { email: 'lead@example.com' },
    'hosts/h1/siteMembers/member-blank': {
      email: 'member@example.com',
      displayName: 'Member',
    },
    'orgs/o1/contacts/contact-blank': { email: 'contact@example.com' },
    'orgs/o1/lists/l1/members/list-blank': { email: 'listed@example.com' },
    // the two that must survive untouched
    'orgs/o1/contacts/refused': {
      email: 'refused@example.com',
      marketingConsent: false,
    },
    'orgs/o1/contacts/opted-in': {
      email: 'optedin@example.com',
      marketingConsent: true,
      marketingConsentAtMs: 111,
    },
    // and the ones with nothing to assert about
    'orgs/o1/contacts/no-address': { name: 'Nobody' },
    'orgs/o1/contacts/odd-value': {
      email: 'odd@example.com',
      marketingConsent: 'yes',
    },
    'orgs/o1/contacts/real-looking': {
      email: 'someone@gmail.com',
      name: 'Someone Real',
    },
  }

  const seed = async (orgOver = {}) => {
    await wipe()
    await firestore.collection('hosts').doc('h1').set({ subdomain: 'h1' })
    await firestore
      .collection('orgs')
      .doc('o1')
      .set({ name: 'Seed Org', plan: 'free', ...orgOver })
    await firestore.collection('orgs').doc('o1').collection('lists').doc('l1').set({ name: 'L' })
    for (const [path, data] of Object.entries(PEOPLE)) {
      await firestore.doc(path).set(data)
    }
  }
  const data = async (path) => (await firestore.doc(path).get()).data()
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all(Object.keys(PEOPLE).map((p) => data(p))),
    )

  console.log('\nself-test (emulator fixtures)\n')

  // --- 1. a dry run must change NOTHING. Compared byte-for-byte, because
  //        "the counts looked right" is how a dry run that writes gets shipped.
  await seed()
  const before = await snapshot()
  const dry = await run()
  check('a dry run leaves every record byte-identical', before === (await snapshot()))
  // Every silo, because a sweep that forgets one reports a clean run over the
  // three it remembered. `contacts` stages two grantable records; the others
  // stage one each.
  check(
    'a dry run still PLANS a grant in every one of the four silos',
    SILOS.every((silo) => dry.tally[silo].granted >= 1) &&
      dry.tally.contacts.granted === 2,
    `(${SILOS.map((s) => `${s}=${dry.tally[s].granted}`).join(' ')})`,
  )

  // --- 2. the apply run
  const applied = await run({ write: true })
  check(
    'apply gives an unrecorded record a basis',
    (await data('orgs/o1/contacts/contact-blank'))?.marketingConsent === true,
  )
  check(
    'and stamps WHO asserted it, when, and why',
    JSON.stringify((await data('orgs/o1/contacts/contact-blank'))?.[SOURCE_FIELD]) ===
      JSON.stringify({ kind: SOURCE_KIND, by: OPERATOR, atMs: AT, reason: REASON }),
    JSON.stringify((await data('orgs/o1/contacts/contact-blank'))?.[SOURCE_FIELD]),
  )
  check(
    'so a backfilled record is NOT byte-identical to a real opt-in',
    JSON.stringify(await data('orgs/o1/contacts/contact-blank')) !==
      JSON.stringify({ email: 'contact@example.com', marketingConsent: true, marketingConsentAtMs: AT }),
  )
  check(
    'every silo was actually written, not just counted',
    (await data('hosts/h1/leads/lead-blank'))?.marketingConsent === true &&
      (await data('hosts/h1/siteMembers/member-blank'))?.marketingConsent === true &&
      (await data('orgs/o1/lists/l1/members/list-blank'))?.marketingConsent === true,
  )

  // --- 3. ⛔ THE RULE WITH NO EXCEPTION. A stored refusal survives an apply
  //        run untouched — not merely unmailed, untouched.
  check(
    '⛔ a DECLINED record is byte-identical after --apply',
    JSON.stringify(await data('orgs/o1/contacts/refused')) ===
      JSON.stringify(PEOPLE['orgs/o1/contacts/refused']),
    JSON.stringify(await data('orgs/o1/contacts/refused')),
  )
  check(
    'and it is reported as skipped for being declined',
    applied.tally.contacts.skipped['declined'] === 1,
    JSON.stringify(applied.tally.contacts.skipped),
  )

  // --- 4. an existing grant keeps its own date — the evidence behind it
  check(
    'an existing GRANTED record keeps its own timestamp, unrestamped',
    JSON.stringify(await data('orgs/o1/contacts/opted-in')) ===
      JSON.stringify(PEOPLE['orgs/o1/contacts/opted-in']),
    JSON.stringify(await data('orgs/o1/contacts/opted-in')),
  )

  // --- 5. the records with nothing to assert
  check(
    'a record with no usable address is left alone',
    JSON.stringify(await data('orgs/o1/contacts/no-address')) ===
      JSON.stringify(PEOPLE['orgs/o1/contacts/no-address']),
  )
  check(
    'a non-boolean consent value is skipped, not normalized to true',
    JSON.stringify(await data('orgs/o1/contacts/odd-value')) ===
      JSON.stringify(PEOPLE['orgs/o1/contacts/odd-value']),
    JSON.stringify(await data('orgs/o1/contacts/odd-value')),
  )

  // --- 6. IDEMPOTENCE. A second apply must write nothing and change nothing.
  const settled = await snapshot()
  const second = await run({ write: true })
  check(
    're-running writes nothing',
    second.wrote.length === 0,
    `(wrote ${second.wrote.length}: ${second.wrote.join(', ')})`,
  )
  check(
    're-running plans nothing',
    SILOS.every((silo) => second.tally[silo].granted === 0),
    `(${SILOS.map((s) => `${s}=${second.tally[s].granted}`).join(' ')})`,
  )
  check('re-running leaves every record byte-identical', settled === (await snapshot()))
  check(
    'and it distinguishes what IT backfilled from a real opt-in',
    second.tally.contacts.skipped['already backfilled'] === 2 &&
      second.tally.contacts.skipped['already granted'] === 1,
    JSON.stringify(second.tally.contacts.skipped),
  )

  // --- 7. THE CONTROL. Every assertion above would also pass against a run
  //        that found nothing at all, so prove the harness still sees work.
  await firestore.doc('orgs/o1/contacts/newly-staged').set({ email: 'new@example.com' })
  const control = await run()
  check(
    'CONTROL: a newly staged record is detected (the checks above can fail)',
    control.tally.contacts.granted === 1,
    `(granted=${control.tally.contacts.granted})`,
  )

  // --- 8. THE RACE. A refusal recorded between the sweep and the write must
  //        still be honored. Without the transaction's re-read every check
  //        above stays green and this one is the only thing that reds.
  await seed()
  const raced = await run({
    write: true,
    tamper: async (ref) => {
      if (ref.path === 'orgs/o1/contacts/contact-blank') {
        await ref.update({ marketingConsent: false })
      }
    },
  })
  check(
    '⛔ a refusal recorded DURING the sweep is not overwritten',
    (await data('orgs/o1/contacts/contact-blank'))?.marketingConsent === false &&
      (await data('orgs/o1/contacts/contact-blank'))?.[SOURCE_FIELD] === undefined,
    JSON.stringify(await data('orgs/o1/contacts/contact-blank')),
  )
  check(
    'and the report says so rather than claiming the grant',
    raced.tally.contacts.skipped['declined (changed under the sweep)'] === 1 &&
      !raced.wrote.includes('orgs/o1/contacts/contact-blank'),
    JSON.stringify(raced.tally.contacts.skipped),
  )

  // --- 9. --exclude drops a named address
  await seed()
  const excluded = await run({
    write: true,
    excluded: new Set(['contact@example.com']),
  })
  check(
    'an excluded address is not given a basis',
    (await data('orgs/o1/contacts/contact-blank'))?.marketingConsent === undefined &&
      excluded.tally.contacts.skipped['excluded'] === 1,
  )

  // --- 10. the report calls out what does not look like fixture data
  await seed()
  const flagged = await run()
  check(
    'a non-fixture domain is reported for a human to look at',
    flagged.notSeed.length === 1 &&
      flagged.notSeed[0].email === 'someone@gmail.com',
    JSON.stringify(flagged.notSeed),
  )
  check(
    'CONTROL: fixture domains are NOT reported (the check above can fail)',
    !flagged.notSeed.some((row) => row.email.endsWith('@example.com')),
  )

  // --- 11. PRECONDITION 1 — a paying org refuses the run
  await seed({ plan: 'growth', billingStatus: 'active' })
  check(
    'a live subscription on a paid plan refuses --apply',
    (await billingCustomers(firestore)).length === 1,
  )
  await seed({ plan: 'growth', billingStatus: 'canceled' })
  check(
    'CONTROL: a canceled one does not (the check above can fail)',
    (await billingCustomers(firestore)).length === 0,
  )
  await seed({ plan: 'enterprise' })
  check(
    'a staff plan override with no subscription is not a customer',
    (await billingCustomers(firestore)).length === 0,
  )
  await firestore
    .doc('orgs/o1/billing/stripe')
    .set({ subscription: { status: 'past_due' } })
  await firestore.doc('orgs/o1').set({ plan: 'enterprise' })
  check(
    'a subscription stored only under billing/stripe is still seen',
    (await billingCustomers(firestore)).length === 1,
    'AGL-1028 moved it there; reading the org mirror alone would miss it',
  )

  // --- 12. PRECONDITION 3 — the reader guard, and the prose that must not
  //         satisfy it. Deleting the guard leaves everything above green.
  const realSource = readFileSync(CONSENT_MODULE, 'utf8')
  check(
    'the reader guard passes against the real consent module',
    readerUnderstandsProvenance(realSource).ok,
    readerUnderstandsProvenance(realSource).why,
  )
  check(
    'CONTROL: an unrelated module is refused (the check above can fail)',
    !readerUnderstandsProvenance('export const x = 1').ok,
  )
  const proseOnly =
    `/** Someday this will read ${SOURCE_FIELD} of kind ${SOURCE_KIND}\n` +
    ` * and report assertedBy. */\nexport const x = 1\n`
  check(
    'a comment merely NAMING the field does not satisfy it',
    !readerUnderstandsProvenance(proseOnly).ok,
    readerUnderstandsProvenance(proseOnly).why,
  )
  check(
    'CONTROL: that fixture really does name all three (a substring count would pass)',
    proseOnly.includes(SOURCE_FIELD) &&
      proseOnly.includes(SOURCE_KIND) &&
      proseOnly.includes('assertedBy'),
  )
  check(
    'naming the field but never surfacing whose act it was is refused',
    !readerUnderstandsProvenance(
      `const f = '${SOURCE_FIELD}'\nconst k = '${SOURCE_KIND}'\n`,
    ).ok,
  )
  // A line comment containing `/*` must not swallow the code below it.
  const slashStarInLineComment =
    `// see hosts/{hostId}/datasets/* for the shape\n` +
    `const f = '${SOURCE_FIELD}'\nconst k = '${SOURCE_KIND}'\nconst a = 'assertedBy'\n` +
    `/* a later block comment, as every real module has */\n`
  check(
    'a line comment containing `/*` does not swallow the code it precedes',
    readerUnderstandsProvenance(slashStarInLineComment).ok,
    readerUnderstandsProvenance(slashStarInLineComment).why,
  )

  console.log(
    failures.length
      ? `\n${failures.length} FAILED: ${failures.join('; ')}\n`
      : '\nall self-test assertions passed\n',
  )
  return failures.length === 0
}

// ---------------------------------------------------------------- main
if (selfTest) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('--self-test requires FIRESTORE_EMULATOR_HOST. Refusing.')
    process.exit(1)
  }
  initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-consent-backfill' })
  const ok = await runSelfTest(getFirestore())
  process.exit(ok ? 0 : 1)
}

/**
 * PRECONDITION 4 — somebody is named. A service account identifies itself,
 * a human has to say who they are, and `by` is never allowed to be blank
 * because a basis attributed to nobody is not attributable.
 */
function resolveOperator() {
  const declared = flag('operator') ?? process.env.AGLYN_BACKFILL_OPERATOR
  if (declared?.trim()) return declared.trim()
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (keyFile) {
    try {
      const email = JSON.parse(readFileSync(keyFile, 'utf8')).client_email
      if (email) return String(email)
    } catch {
      // Falls through to the refusal below — a credentials file this script
      // cannot parse is not an identity it may guess at.
    }
  }
  return null
}

const operator = resolveOperator()
const reason = flag('reason')?.trim() || DEFAULT_REASON
const excluded = new Set(
  (flag('exclude') ?? '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean),
)
/*
 * Lower only. Raising the ceiling is a decision about whose consent is being
 * asserted; it belongs in a reviewed diff, not in an argument typed next to
 * `--apply` by whoever hit the refusal.
 *
 * The flag's ABSENCE is checked before its value, because `Number(null)` is
 * 0 and 0 is finite — reading an unpassed flag as a number silently clamps
 * the ceiling to zero and refuses every run, including the one this script
 * exists to make.
 */
const requestedMax = flag('max-records') === null ? NaN : Number(flag('max-records'))
const maxRecords = Number.isFinite(requestedMax)
  ? Math.min(requestedMax, MAX_RECORDS)
  : MAX_RECORDS

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? 'aglyn-main',
})
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const refusals = []
const reader = readerUnderstandsProvenance()
if (!reader.ok) {
  refusals.push(
    `the consent reader does not understand the provenance this writes — ` +
      `${reader.why}. Every record would be indistinguishable from a real opt-in.`,
  )
}
if (!operator) {
  refusals.push(
    'no operator is named. Pass --operator=<who> (or set ' +
      'AGLYN_BACKFILL_OPERATOR). A basis attributed to nobody is not attributable.',
  )
}
const paying = await billingCustomers(firestore)
if (paying.length) {
  refusals.push(
    `${paying.length} org(s) hold a live subscription — ` +
      `${paying.map((o) => `${o.id} (${o.name}, ${o.plan}, ${o.status})`).join('; ')}. ` +
      'This product is not pre-release any more, and these records are not ' +
      'all seed data. Asserting consent over them is not this script’s call.',
  )
}

const result = await backfill(firestore, {
  write: false,
  operator: operator ?? '(unnamed)',
  reason,
  excluded,
  atMs: Date.now(),
})
if (result.total > maxRecords) {
  refusals.push(
    `${result.total} records is over the ${maxRecords} ceiling. Seed data is ` +
      'tens of records; this is an audience. The premise this backfill was ' +
      'authorized under has expired — --max-records only lowers the ceiling.',
  )
}

report(result, { write: false, operator: operator ?? '(unnamed)', reason })

if (apply && refusals.length) {
  console.error(
    `REFUSING TO APPLY.\n${refusals.map((r) => `  • ${r}`).join('\n')}\n`,
  )
  process.exit(1)
}
if (refusals.length) {
  console.log(
    `⚠️  --apply is blocked:\n${refusals.map((r) => `  • ${r}`).join('\n')}\n`,
  )
}
if (apply) {
  const applied = await backfill(firestore, {
    write: true,
    operator,
    reason,
    excluded,
    atMs: Date.now(),
  })
  report(applied, { write: true, operator, reason })
}
process.exit(0)
