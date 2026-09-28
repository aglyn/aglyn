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

/**
 * The deliverability check, run over every lead and contact captured before
 * it existed (AGL-3328).
 *
 * A capture now looks up the address's domain after its write and puts
 * `undeliverable` — "Would bounce" — on the record when the domain takes no
 * mail (`libs/tenant/data/admin/src/lib/server/capture-email-check.ts`).
 * A record written before that carries no verdict. This walks
 * `orgs/{orgId}/contacts` and `orgs/{orgId}/leads`, asks each distinct
 * domain ONCE — the platform MX cache `mailDomains/{domain}` first, DNS when
 * the cached answer is missing or stale — and brings each record level:
 *
 *   domain takes no mail (no MX, or RFC 7505's null MX)
 *       → `emailState: { status: 'undeliverable', source: 'check', … }` and
 *         `emailStatus: 'undeliverable'`, unless the record holds a verdict
 *         at least as strong (the ranking `email-state.ts` keeps: a bounce,
 *         a block, an unsubscribe outranks it)
 *   domain takes mail, and the record holds the check's own "Would bounce"
 *       → the verdict withdrawn: `emailState` deleted, `emailStatus: 'none'`
 *   anything else, or a domain nobody could answer for → left alone
 *
 * "No MX" stands only when the pinned public resolvers AND the runtime's
 * own agree, the rule the live resolver keeps; a lookup nobody answered is
 * "unknown" and writes nothing.
 *
 * ## Idempotence
 *
 * A record already holding what the plan would write is counted as current,
 * so a second run writes nothing. `updatedAt` is never touched: a verdict is
 * something that happened to the address, not an edit, and the lists order
 * by it. A fresh lookup is written to the cache only with `--apply`.
 *
 * ## Running it
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-deliverability.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-email-deliverability.mjs --apply  # write
 *
 * `--org <id>` limits the run to one organization; `--self-test` runs the
 * fixtures, touching no project and no resolver.
 */
import { promises as dns, Resolver } from 'node:dns'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const args = parseDeployArgs({
  command: 'backfill-email-deliverability',
  summary:
    'Mark every lead and contact whose email domain takes no mail as "Would bounce", ' +
    'from the platform MX cache. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
    { flag: '--org', key: 'org', value: 'string', describe: 'Limit to one organization.' },
  ],
})

const COLLECTIONS = ['contacts', 'leads']
/** Documents per batch; Firestore allows 500, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 500
/** Cache documents read per `getAll`. */
const GET_ALL_CHUNK = 300
/** Domains looked up at once. */
const LOOKUP_CONCURRENCY = 16

/** `mail-gateway.ts`: a week for a domain that takes mail, a day for one that does not. */
const MAIL_DOMAIN_INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAIL_DOMAIN_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
/** `dns-probe.ts`: the resolvers asked before the runtime's own. */
const PUBLIC_DNS_RESOLVERS = ['1.1.1.1', '8.8.8.8']
const MAIL_DOMAIN_STATUSES = ['mx', 'implicit_mx', 'null_mx', 'no_mx']

/** `mail-gateway.ts`'s suffix table, restated: the gateway an MX exchange names. */
const GATEWAY_HOST_SUFFIXES = [
  ['barracuda', ['.ess.barracudanetworks.com', '.barracudanetworks.com']],
  ['proofpoint', ['.pphosted.com', '.ppe-hosted.com', '.proofpoint.com']],
  ['mimecast', ['.mimecast.com', '.mimecast.co.za', '.mimecast-offshore.com']],
  ['google', ['.google.com', '.googlemail.com', '.gmail.com']],
  ['microsoft', ['.mail.protection.outlook.com', '.outlook.com', '.protection.outlook.com']],
]

const normalizeHost = (host) =>
  String(host ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')

/** `classifyMailGateway`, restated. */
export function classifyMailGateway(hosts) {
  const names = hosts.map(normalizeHost).filter(Boolean)
  if (!names.length) return 'none'
  for (const name of names) {
    for (const [gateway, suffixes] of GATEWAY_HOST_SUFFIXES) {
      if (suffixes.some((suffix) => name === suffix.slice(1) || name.endsWith(suffix))) return gateway
    }
  }
  return 'other'
}

/** The address's domain, lowercased, or `null` for something that is not an address. */
export function emailDomain(email) {
  const value = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320) return null
  return value.slice(value.lastIndexOf('@') + 1)
}

/** Whether a status means the domain takes no mail. */
export const refusesMail = (status) => status === 'no_mx' || status === 'null_mx'

/** A cached answer, when it is one and is still trusted at `nowMs`. */
export function freshCachedAnswer(data, nowMs) {
  if (!data || !MAIL_DOMAIN_STATUSES.includes(data.status)) return null
  const resolvedAtMs = Number(data.resolvedAtMs) || 0
  const ttl = refusesMail(data.status) ? MAIL_DOMAIN_NEGATIVE_TTL_MS : MAIL_DOMAIN_INTEL_TTL_MS
  return resolvedAtMs + ttl > nowMs ? { status: data.status } : null
}

/**
 * A domain's mail setup from its MX answer — `resolveMailDomain`, restated:
 * real exchanges are `mx`; records that are all "." are a null MX; none at
 * all fall to the address records.
 */
export function classifyMxAnswer(records, hasAddress) {
  const exchanges = [...(records ?? [])]
    .sort((a, b) => (Number(a?.priority) || 0) - (Number(b?.priority) || 0))
    .map((record) => normalizeHost(record?.exchange))
  const real = exchanges.filter((exchange) => exchange && exchange !== '.')
  if (real.length) return { status: 'mx', mx: real, gateway: classifyMailGateway(real) }
  if (exchanges.length) return { status: 'null_mx', mx: [], gateway: 'none' }
  if (hasAddress) return { status: 'implicit_mx', mx: [], gateway: 'other' }
  return { status: 'no_mx', mx: [], gateway: 'none' }
}

/** The verdict the check writes, as `capture-email-check.ts` words it. */
export function undeliverableState(domain, status, atMs) {
  return {
    status: 'undeliverable',
    atMs,
    source: 'check',
    detail: status === 'null_mx' ? `${domain} publishes a null MX record: it says it accepts no email.` : null,
  }
}

/** `email-state.ts`'s ranking: a verdict replaces one it is at least as strong as. */
const EMAIL_STATE_RANK = {
  ok: 0,
  undeliverable: 1,
  bounced: 2,
  blocked: 3,
  unsubscribed: 4,
  complained: 5,
  do_not_contact: 6,
}

/**
 * One record's plan, given its domain's status (`null` when unknown), so a
 * dry run and an apply run cannot disagree.
 *
 * @returns {{ stamp: object } | { withdraw: true } | { skip: string }}
 */
export function planRecord(record, domain, status, nowMs) {
  if (!domain) return { skip: 'no-address' }
  if (!status) return { skip: 'unknown' }
  const current = record?.emailState && typeof record.emailState === 'object' ? record.emailState : null
  const currentStatus = current && current.status in EMAIL_STATE_RANK ? current.status : null
  if (refusesMail(status)) {
    if (currentStatus === 'undeliverable') {
      return record.emailStatus === 'undeliverable' ? { skip: 'current' } : { stamp: current }
    }
    if (currentStatus && EMAIL_STATE_RANK[currentStatus] > EMAIL_STATE_RANK.undeliverable) {
      return { skip: 'stronger' }
    }
    return { stamp: undeliverableState(domain, status, nowMs) }
  }
  if (currentStatus === 'undeliverable') return { withdraw: true }
  return { skip: 'current' }
}

/** The update a plan writes. */
function updateFor(plan) {
  return 'withdraw' in plan
    ? { emailState: FieldValue.delete(), emailStatus: 'none' }
    : { emailState: plan.stamp, emailStatus: 'undeliverable' }
}

/*==========================================
 * DNS
 *==========================================*/

const CONCLUSIVE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN'])

/** One record type from the pinned resolvers, then the runtime's; `null` when nobody answered. */
async function ask(kind, domain) {
  const pinned = new Resolver()
  pinned.setServers(PUBLIC_DNS_RESOLVERS)
  const call = (resolver) =>
    new Promise((resolve, reject) => resolver[kind](domain, (error, answer) => (error ? reject(error) : resolve(answer))))
  let pinnedAnswer
  try {
    pinnedAnswer = await call(pinned)
    if (pinnedAnswer.length) return pinnedAnswer
  } catch (error) {
    if (!CONCLUSIVE.has(error?.code)) pinnedAnswer = null
    else pinnedAnswer = []
  }
  // "Nothing here" stands only when the runtime's resolver agrees — the
  // live resolver's rule for the one answer that stops mail.
  try {
    return await dns[kind](domain)
  } catch (error) {
    if (CONCLUSIVE.has(error?.code)) return []
    return pinnedAnswer && pinnedAnswer.length ? pinnedAnswer : null
  }
}

/** A domain looked up, or `null` when nobody answered. */
async function lookUp(domain) {
  const mx = await ask('resolveMx', domain)
  if (mx === null) return null
  if (mx.length) return classifyMxAnswer(mx, false)
  const v4 = await ask('resolve4', domain)
  if (v4 && v4.length) return classifyMxAnswer([], true)
  const v6 = await ask('resolve6', domain)
  if (v6 && v6.length) return classifyMxAnswer([], true)
  if (v4 === null || v6 === null) return null
  return classifyMxAnswer([], false)
}

/*==========================================
 * THE SELF-TEST
 *==========================================*/

function selfTest() {
  const NOW = Date.parse('2026-09-28T12:00:00Z')
  let failed = 0
  let total = 0
  const check = (name, ok) => {
    total += 1
    if (!ok) {
      failed += 1
      console.error(`FAIL ${name}`)
    }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  check('an MX answer is mx, and names its gateway', same(
    classifyMxAnswer([{ exchange: 'd1.ess.barracudanetworks.com.', priority: 10 }], false),
    { status: 'mx', mx: ['d1.ess.barracudanetworks.com'], gateway: 'barracuda' },
  ))
  check('a lone "." is a null MX', classifyMxAnswer([{ exchange: '.', priority: 0 }], false).status === 'null_mx')
  check('an empty exchange is a null MX', classifyMxAnswer([{ exchange: '', priority: 0 }], false).status === 'null_mx')
  check('no MX with an address is an implicit MX', classifyMxAnswer([], true).status === 'implicit_mx')
  check('no MX and no address is no MX', classifyMxAnswer([], false).status === 'no_mx')
  check('an unknown exchange is other', classifyMailGateway(['mx.example.net']) === 'other')

  check('a week-old "takes mail" is stale', freshCachedAnswer({ status: 'mx', resolvedAtMs: NOW - 8 * 86_400_000 }, NOW) === null)
  check('a six-day-old "takes mail" is trusted', freshCachedAnswer({ status: 'mx', resolvedAtMs: NOW - 6 * 86_400_000 }, NOW)?.status === 'mx')
  check('a two-day-old "takes none" is stale', freshCachedAnswer({ status: 'no_mx', resolvedAtMs: NOW - 2 * 86_400_000 }, NOW) === null)
  check('an unreadable status is no answer', freshCachedAnswer({ status: 'maybe', resolvedAtMs: NOW }, NOW) === null)

  check('a non-address is skipped', 'skip' in planRecord({ email: 'nope' }, emailDomain('nope'), 'no_mx', NOW))
  check('an unknown domain writes nothing', planRecord({}, 'down.example', null, NOW).skip === 'unknown')

  const stamped = planRecord({}, 'parked.example', 'no_mx', NOW)
  check('a domain with no MX stamps "Would bounce"', same(stamped, {
    stamp: { status: 'undeliverable', atMs: NOW, source: 'check', detail: null },
  }))
  const nulled = planRecord({}, 'nomail.example', 'null_mx', NOW)
  check('a null MX says so in the detail', /null MX/.test(nulled.stamp?.detail ?? ''))
  check('a re-run is a no-op', planRecord({ emailState: stamped.stamp, emailStatus: 'undeliverable' }, 'parked.example', 'no_mx', NOW + 1).skip === 'current')
  check('a missing list key is restamped with the standing verdict', same(
    planRecord({ emailState: stamped.stamp }, 'parked.example', 'no_mx', NOW + 1),
    { stamp: stamped.stamp },
  ))
  check('a bounce is never replaced', planRecord({ emailState: { status: 'bounced' } }, 'parked.example', 'no_mx', NOW).skip === 'stronger')
  check('a release is replaced, as the live ranking replaces it', 'stamp' in planRecord({ emailState: { status: 'ok' } }, 'parked.example', 'no_mx', NOW))
  check('a domain that takes mail again withdraws "Would bounce"', same(
    planRecord({ emailState: stamped.stamp, emailStatus: 'undeliverable' }, 'parked.example', 'mx', NOW),
    { withdraw: true },
  ))
  check('a domain that takes mail never clears a bounce', planRecord({ emailState: { status: 'bounced' } }, 'x.example', 'mx', NOW).skip === 'current')
  check('a withdrawn record is current on the next run', planRecord({ emailStatus: 'none' }, 'parked.example', 'mx', NOW).skip === 'current')
  check('updatedAt is never written', !('updatedAt' in updateFor(stamped)) && !('updatedAt' in updateFor({ withdraw: true })))

  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

/*==========================================
 * THE RUN
 *==========================================*/

/** Runs `work` over `items`, at most `limit` at a time. */
async function eachLimited(items, limit, work) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next]
        next += 1
        await work(item)
      }
    }),
  )
}

/** Each domain's status, from the cache or DNS, once per run; `null` for unknown. */
async function resolveDomains(firestore, domains, answers, tally, nowMs) {
  const wanted = [...domains].filter((domain) => !answers.has(domain))
  if (!wanted.length) return
  const cache = firestore.collection('mailDomains')
  const stale = []
  for (let at = 0; at < wanted.length; at += GET_ALL_CHUNK) {
    const chunk = wanted.slice(at, at + GET_ALL_CHUNK)
    const snapshots = await firestore.getAll(...chunk.map((domain) => cache.doc(domain)))
    chunk.forEach((domain, index) => {
      const fresh = freshCachedAnswer(snapshots[index]?.exists ? snapshots[index].data() : null, nowMs)
      if (fresh) {
        answers.set(domain, fresh.status)
        tally.cached += 1
      } else {
        stale.push(domain)
      }
    })
  }
  await eachLimited(stale, LOOKUP_CONCURRENCY, async (domain) => {
    const found = await lookUp(domain).catch(() => null)
    if (!found) {
      answers.set(domain, null)
      tally.unanswered += 1
      return
    }
    answers.set(domain, found.status)
    tally.lookedUp += 1
    if (args.apply) {
      await cache
        .doc(domain)
        .set({ domain, status: found.status, mx: found.mx, gateway: found.gateway, resolvedAtMs: nowMs })
        .catch((error) => console.error(`  the MX of ${domain} could not be cached`, error?.message ?? error))
    }
  })
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const nowMs = Date.now()
  const orgIds = args.org
    ? [args.org]
    : (await firestore.collection('orgs').select().get()).docs.map((doc) => doc.id)

  const answers = new Map()
  const domainTally = { cached: 0, lookedUp: 0, unanswered: 0 }
  const counts = Object.fromEntries(
    COLLECTIONS.map((name) => [name, { scanned: 0, current: 0, stamp: 0, withdraw: 0, written: 0, skipped: {} }]),
  )

  for (const orgId of orgIds) {
    for (const name of COLLECTIONS) {
      const tally = counts[name]
      let cursor = null
      for (;;) {
        let page = firestore
          .collection('orgs')
          .doc(orgId)
          .collection(name)
          .select('email', 'emailState', 'emailStatus')
          .orderBy(FieldPath.documentId())
          .limit(PAGE)
        if (cursor) page = page.startAfter(cursor)
        const snapshot = await page.get()
        if (snapshot.empty) break
        const rows = snapshot.docs.map((doc) => ({ doc, data: doc.data(), domain: emailDomain(doc.get('email')) }))
        await resolveDomains(
          firestore,
          new Set(rows.map((row) => row.domain).filter(Boolean)),
          answers,
          domainTally,
          nowMs,
        )
        const writes = []
        for (const { doc, data, domain } of rows) {
          tally.scanned += 1
          const plan = planRecord(data, domain, domain ? (answers.get(domain) ?? null) : null, nowMs)
          if ('skip' in plan) {
            if (plan.skip === 'current') tally.current += 1
            else tally.skipped[plan.skip] = (tally.skipped[plan.skip] ?? 0) + 1
            continue
          }
          if ('withdraw' in plan) tally.withdraw += 1
          else tally.stamp += 1
          if (args.apply) writes.push([doc.ref, updateFor(plan)])
        }
        for (let at = 0; at < writes.length; at += BATCH) {
          const batch = firestore.batch()
          const chunk = writes.slice(at, at + BATCH)
          for (const [ref, update] of chunk) batch.update(ref, update)
          await batch.commit()
          tally.written += chunk.length
        }
        cursor = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.size < PAGE) break
      }
    }
  }

  console.log(
    args.apply
      ? 'backfill-email-deliverability: APPLIED'
      : 'backfill-email-deliverability: DRY RUN (nothing written)',
  )
  console.log(`  organizations  ${orgIds.length}`)
  console.log(
    `  domains        ${answers.size} (cached ${domainTally.cached}, looked up ${domainTally.lookedUp}, ` +
      `unanswered ${domainTally.unanswered})`,
  )
  for (const name of COLLECTIONS) {
    const tally = counts[name]
    const skipped = Object.entries(tally.skipped)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ')
    console.log(
      `  ${name.padEnd(9)} scanned ${tally.scanned}, current ${tally.current}, ` +
        `would stamp ${tally.stamp}, would withdraw ${tally.withdraw}` +
        (args.apply ? `, written ${tally.written}` : '') +
        (skipped ? ` (skipped: ${skipped})` : ''),
    )
  }
}

await main()
