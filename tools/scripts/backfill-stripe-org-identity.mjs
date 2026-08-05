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
 * Backfill `name` / `description` / `metadata[orgId|orgSlug]` onto Stripe
 * customers that predate AGL-941.
 *
 * The webhook now stamps this on every subscription event, so any org with
 * activity self-heals. This is for the ones that will not have another event
 * soon — a cancelled org, or one on an annual plan eleven months out.
 *
 * ## DRY RUN BY DEFAULT — and that is deliberate
 *
 * `STRIPE_SECRET_KEY` on a developer machine is a **live** key (it was
 * switched on 2026-07-29), so an accidental run writes to real customer
 * records. Nothing is sent unless you pass `--apply`, and the key's mode is
 * printed before anything happens.
 *
 *   node tools/scripts/backfill-stripe-org-identity.mjs            # report
 *   node tools/scripts/backfill-stripe-org-identity.mjs --apply    # write
 *
 * Idempotent: re-running writes the same values. It does NOT merge metadata —
 * Stripe merges keys server-side, so unrelated metadata on the customer is
 * preserved, but a key of the same name is overwritten.
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const SECRET = process.env.STRIPE_SECRET_KEY

/**
 * Mirrors `apps/console/utils/stripe-customer-identity.ts`.
 *
 * A deliberate copy, not an import: this is a plain `.mjs` script with no
 * build step and no path aliases, and the alternative — a second tsconfig
 * just for scripts — costs more than eight lines. If the rule there changes,
 * change it here; the shape is pinned by that file's spec.
 */
export function identityParams({ orgId, name, slug }) {
  const trimmedName = name?.trim()
  const trimmedSlug = slug?.trim()
  if (!orgId || (!trimmedName && !trimmedSlug)) return null
  const params = { 'metadata[orgId]': orgId }
  if (trimmedSlug) params['metadata[orgSlug]'] = trimmedSlug
  params['name'] = trimmedName || trimmedSlug
  params['description'] = trimmedSlug
    ? `Aglyn workspace: ${trimmedSlug}`
    : `Aglyn workspace ${orgId}`
  return params
}

async function main() {
  if (!SECRET) {
    console.error('STRIPE_SECRET_KEY is not set — nothing to do.')
    process.exit(1)
  }
  const mode = SECRET.startsWith('sk_live') ? 'LIVE' : 'test'
  console.log(`Stripe mode: ${mode}`)
  console.log(APPLY ? 'MODE: APPLY (writes)' : 'MODE: dry run (no writes)')
  if (APPLY && mode === 'LIVE') {
    console.log('Writing to LIVE customer records in 5s — Ctrl-C to abort.')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  if (!getApps().length) initializeApp({ credential: applicationDefault() })
  const db = getFirestore()

  const orgs = await db.collection('orgs').get()
  let considered = 0
  let skippedNoCustomer = 0
  let skippedNoIdentity = 0
  let written = 0
  let failed = 0

  for (const org of orgs.docs) {
    considered += 1
    // AGL-1028: the id moved to `orgs/{orgId}/billing/stripe`, with the org
    // doc as the legacy fallback. Read both or the backfill misses whichever
    // half has not migrated.
    const billing = await org.ref.collection('billing').doc('stripe').get()
    const customerId =
      billing.get('stripeCustomerId') ?? org.get('stripeCustomerId')
    if (!customerId) {
      skippedNoCustomer += 1
      continue
    }
    const params = identityParams({
      orgId: org.id,
      name: org.get('name'),
      slug: org.get('slug'),
    })
    if (!params) {
      // Same rule as the runtime path: a customer named after a raw document
      // id is worse than one named after the owner's email.
      skippedNoIdentity += 1
      console.log(`  skip ${org.id} (${customerId}): no name or slug`)
      continue
    }

    if (!APPLY) {
      console.log(`  would stamp ${customerId} <- ${params['name']}`)
      continue
    }
    try {
      const response = await fetch(
        `https://api.stripe.com/v1/customers/${customerId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(params).toString(),
        },
      )
      if (!response.ok) {
        failed += 1
        console.error(
          `  FAILED ${customerId}: ${response.status} ${await response.text()}`,
        )
        continue
      }
      written += 1
      console.log(`  stamped ${customerId} <- ${params['name']}`)
    } catch (error) {
      failed += 1
      console.error(`  FAILED ${customerId}:`, error)
    }
  }

  // Every bucket, always — a run that reports only successes hides the orgs
  // it decided to skip, which is the number you actually want afterwards.
  console.log(
    `\norgs=${considered} stamped=${written} ` +
      `skipped(no customer)=${skippedNoCustomer} ` +
      `skipped(no name/slug)=${skippedNoIdentity} failed=${failed}`,
  )
  if (failed) process.exit(1)
}

// Only when RUN, never when imported. The drift guard in
// `apps/console/specs/stripe-customer-identity.spec.ts` imports this file to
// compare `identityParams` against the TypeScript original — without this
// check, that import would start a backfill against live Stripe.
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
