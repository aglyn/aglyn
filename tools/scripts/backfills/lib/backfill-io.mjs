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

// Shared I/O for the tools/scripts/backfills/ scripts: argument gating,
// Firebase Admin bootstrap, and READ-ONLY Stripe access.
//
// The apply gate is deliberately double-keyed: `--apply` alone still dry
// runs, loudly — production writes require BOTH `--apply` and
// `--yes-i-mean-production` (these scripts rewrite merchant-facing
// financial history; AGL-1727/1745/1752/1753 record that the apply is
// Zach's call, made after the dry-run numbers are seen).

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

export function parseBackfillArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
  const valueOf = (name) => {
    const index = argv.indexOf(name)
    return index >= 0 ? (argv[index + 1] ?? null) : null
  }
  const wantsApply = flags.has('--apply')
  const confirmed = flags.has('--yes-i-mean-production')
  return {
    // Writes happen ONLY with both flags; anything less is a dry run.
    apply: wantsApply && confirmed,
    applyRequested: wantsApply,
    hostFilter: valueOf('--host'),
    createMissing: flags.has('--create-missing'),
  }
}

export function announceMode(scriptName, args, projectId) {
  if (args.apply) {
    console.log(`${scriptName}: APPLY against project ${projectId}`)
  } else if (args.applyRequested) {
    console.log(
      `${scriptName}: --apply without --yes-i-mean-production — ` +
        `staying in DRY RUN against project ${projectId}`,
    )
  } else {
    console.log(
      `${scriptName}: DRY RUN against project ${projectId} — nothing written`,
    )
  }
}

export function initFirestoreAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY',
    )
    process.exit(1)
  }
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
  return { db: getFirestore(process.env.FIRESTORE_DATABASE_ID), projectId }
}

/**
 * READ-ONLY Stripe call: GET with a query string, never a body (a GET with
 * a body throws silently) and never any other verb — these backfills read
 * invoices and sessions from the LIVE account and must not be able to
 * mutate it even by bug.
 */
export async function stripeGet(path, params = {}) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    console.error('Missing STRIPE_SECRET_KEY (read-only use)')
    process.exit(1)
  }
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(name, String(item))
    } else if (value !== undefined && value !== null) {
      query.append(name, String(value))
    }
  }
  const suffix = query.toString() ? `?${query}` : ''
  const response = await fetch(`https://api.stripe.com/v1/${path}${suffix}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  const body = await response.json()
  if (!response.ok) {
    const error = new Error(
      `Stripe GET ${path} -> ${response.status}: ${body?.error?.message ?? 'unknown'}`,
    )
    error.status = response.status
    throw error
  }
  return body
}

/** Paginated Stripe list — follows `has_more` via `starting_after`. */
export async function stripeList(path, params = {}) {
  const items = []
  let startingAfter
  for (;;) {
    const page = await stripeGet(path, {
      ...params,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    items.push(...(page.data ?? []))
    if (!page.has_more || !page.data?.length) return items
    startingAfter = page.data[page.data.length - 1].id
  }
}

/** Cents to `$12.34` for the dry-run report. */
export const dollars = (cents) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`
