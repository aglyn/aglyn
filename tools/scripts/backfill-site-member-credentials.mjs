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

// Move every site member's password hash off the profile the console lists
// and onto the credential document no client can read (AGL-3308). See
// `docs/SITE_MEMBER_CREDENTIALS_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs --host=<hostId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/site-member-credentials-backfill.mjs`'s and pinned by its test; this
// file reads, prints and writes.
//
// ## What it does
//
// For every `hosts/{hostId}/siteMembers/{id}` still carrying `passwordScrypt`
// or `passwordResetAt`, copies the hash VERBATIM to
// `hosts/{hostId}/siteMemberCredentials/{id}` and deletes both fields from the
// profile, in one transaction per member. A member whose credential document
// already holds a hash — a reset or an admin password set after the promotion
// wrote it — keeps that newer hash; only the stale profile copy is deleted.
//
// ## What it never does
//
// Read or print an address or a hash: every read is masked to the two
// credential fields, and the report is counts per site. Write a member that
// needs nothing — a second run plans nothing. Recreate a member deleted while
// it ran.
//
// ## Ordering
//
// Rules first, then the promotion, then this — straight after the promotion,
// because until it runs every member of a site can read the legacy hashes.
// Run before the promotion is live, it would lock every migrated member out:
// the old sign-in reads the profile alone. `--apply` is refused on a checkout
// whose sign-in does not read the credential document or whose rules do not
// deny it — the tell of a checkout older than the change.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FieldValue } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import {
  CREDENTIAL_FIELDS,
  planMemberCredentials,
  planSiteCredentials,
  rulesDenyCredentials,
  signInReadsCredentials,
} from './lib/site-member-credentials-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-site-member-credentials',
  summary:
    'Move each site member\'s password hash from `hosts/{hostId}/siteMembers` ' +
    'to `hosts/{hostId}/siteMemberCredentials`, deleting it from the profile ' +
    'every member of the site can read. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    {
      flag: '--apply',
      key: 'apply',
      describe: 'Write. Without it, a dry run.',
    },
    {
      flag: '--host',
      key: 'host',
      value: 'string',
      describe: 'Limit to one host id.',
    },
  ],
})
const apply = Boolean(args.apply)
const onlyHost = args.host

/** Reads are masked to these, so no address or name is ever loaded. */
const MASK = { fieldMask: CREDENTIAL_FIELDS }
/** Credential documents fetched per `getAll` in a dry run. */
const LOOKUP_CHUNK = 100

if (apply) {
  const missing = [
    signInReadsCredentials({
      loginSource: read('libs/plugins/commerce/src/lib/server/membership-login.ts'),
      helperSource: read('libs/plugins/commerce/src/lib/server/member-credentials.ts'),
    })
      ? null
      : 'sign-in in this checkout does not read the credential document',
    rulesDenyCredentials(read('cloud/firebase-firestore.rules'))
      ? null
      : 'the rules in this checkout do not deny the credential documents to every client',
  ].filter(Boolean)
  if (missing.length) {
    console.error(`Refusing --apply: ${missing.join('; ')}. NOTHING WAS WRITTEN.`)
    process.exit(2)
  }
}

function read(path) {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8')
  } catch {
    return ''
  }
}

/** The credential documents that exist for these members, by member id. */
async function existingCredentials(db, hostRef, memberIds) {
  const found = new Map()
  for (let start = 0; start < memberIds.length; start += LOOKUP_CHUNK) {
    const refs = memberIds
      .slice(start, start + LOOKUP_CHUNK)
      .map((id) => hostRef.collection('siteMemberCredentials').doc(id))
    for (const snapshot of await db.getAll(...refs, MASK)) {
      if (snapshot.exists) found.set(snapshot.id, snapshot.data() ?? {})
    }
  }
  return found
}

/**
 * One member, in one transaction. The plan is re-made from what the
 * transaction reads, so a route that wrote the credential document between
 * the dry read and now wins, and a member removed in between is left gone.
 */
async function moveMember(db, hostRef, memberId) {
  const profileRef = hostRef.collection('siteMembers').doc(memberId)
  const credentialRef = hostRef.collection('siteMemberCredentials').doc(memberId)
  return db.runTransaction(async (tx) => {
    const [profile, credential] = await tx.getAll(profileRef, credentialRef, MASK)
    if (!profile.exists) return 'gone'
    const plan = planMemberCredentials({
      profile: profile.data() ?? {},
      credential: credential.exists ? (credential.data() ?? {}) : null,
    })
    if (!plan) return 'already'
    if (plan.credentialPatch) {
      tx.set(credentialRef, plan.credentialPatch, { merge: true })
    }
    tx.update(
      profileRef,
      Object.fromEntries(plan.strip.map((field) => [field, FieldValue.delete()])),
    )
    return plan.outcome
  })
}

async function run() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = {
    sites: 0,
    read: 0,
    clean: 0,
    moved: 0,
    superseded: 0,
    stripped: 0,
    written: 0,
    already: 0,
    gone: 0,
    failed: 0,
  }

  const hosts = onlyHost
    ? [db.collection('hosts').doc(onlyHost)]
    : (async function* () {
        for await (const host of everyDocument(db.collection('hosts').select())) {
          yield host.ref
        }
      })()

  for await (const hostRef of hosts) {
    const members = []
    for await (const member of everyDocument(
      hostRef.collection('siteMembers').select(...CREDENTIAL_FIELDS),
    )) {
      members.push({ id: member.id, data: member.data() ?? {} })
    }
    if (!members.length) continue
    const needing = members
      .filter((member) => CREDENTIAL_FIELDS.some((field) => field in member.data))
      .map((member) => member.id)
    const credentials = await existingCredentials(db, hostRef, needing)
    const { writes, counts } = planSiteCredentials({ members, credentials })
    totals.sites += 1
    for (const key of ['read', 'clean', 'moved', 'superseded', 'stripped']) {
      totals[key] += counts[key]
    }
    if (writes.length) {
      console.log(
        `  ${hostRef.id}: ${counts.read} member(s), ${counts.moved} to move, ` +
          `${counts.superseded} superseded, ${counts.stripped} to strip`,
      )
    }
    if (!apply) continue
    for (const write of writes) {
      try {
        const outcome = await moveMember(db, hostRef, write.id)
        if (outcome === 'gone') totals.gone += 1
        else if (outcome === 'already') totals.already += 1
        else totals.written += 1
      } catch (error) {
        totals.failed += 1
        // The member id and the error code only: no address, no hash.
        console.error(
          `  FAILED ${hostRef.id}/${write.id}: ${error?.code ?? error?.message ?? error}`,
        )
      }
    }
  }

  if (onlyHost && !totals.sites) {
    console.log(`Host ${onlyHost} has no site members — nothing to do.`)
  }
  console.log(
    `sites with members: ${totals.sites}. members: ${totals.read} read, ` +
      `${totals.clean} already clean, ${totals.moved} to move, ` +
      `${totals.superseded} superseded by a newer credential, ` +
      `${totals.stripped} carrying no usable hash (stripped)`,
  )
  if (!apply) {
    console.log('Dry run — nothing was written. Re-run with --apply.')
  } else {
    console.log(
      `wrote ${totals.written} member(s); ${totals.already} needed nothing by the ` +
        `time they were written; ${totals.gone} were removed while this ran and ` +
        `were left gone; ${totals.failed} failed`,
    )
  }
  if (totals.failed) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
