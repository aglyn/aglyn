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
 * Reconcile `orgSlugs` against the console project's Vercel domains
 * (AGL-1136).
 *
 * AGL-1135 removed the `*.aglyn.com` wildcard — it served a real console
 * sign-in page on every hostname under the domain — so a workspace subdomain
 * now resolves only if that exact domain is attached to the project. Org
 * creation attaches it, but that is best-effort by design (a DNS API must
 * never fail a signup), so drift is expected rather than exceptional.
 *
 * This is therefore BOTH the drift check and the backfill for every org
 * created between AGL-1135 landing and the attach going live.
 *
 * Dry-run by default. Pass `--commit` to attach what is missing.
 *
 *   node tools/scripts/reconcile-workspace-domains.mjs
 *   node tools/scripts/reconcile-workspace-domains.mjs --commit
 *
 * Env: VERCEL_TOKEN, VERCEL_CONSOLE_PROJECT_ID, VERCEL_TEAM_ID (optional),
 * plus Firebase admin credentials. NEXT_PUBLIC_WORKSPACE_DOMAIN defaults to
 * aglyn.com.
 *
 * TOMBSTONES ARE ATTACHED TOO, on purpose: a renamed-away slug keeps a 308 to
 * its new home, and a redirect can only run on a hostname that resolves.
 * Skipping them would silently break every old link to a renamed workspace.
 */

import process from 'node:process'

const COMMIT = process.argv.includes('--commit')
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'
const TOKEN = process.env.VERCEL_TOKEN
const PROJECT = process.env.VERCEL_CONSOLE_PROJECT_ID
const TEAM = process.env.VERCEL_TEAM_ID
const teamQuery = TEAM ? `?teamId=${encodeURIComponent(TEAM)}` : ''

if (!TOKEN || !PROJECT) {
  console.error(
    'VERCEL_TOKEN and VERCEL_CONSOLE_PROJECT_ID are required.\n' +
      'Without them this cannot tell "no drift" from "could not look", and\n' +
      'reporting the first when it means the second is how a gap survives.',
  )
  process.exit(1)
}

async function vercel(path, init) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, payload }
}

async function main() {
  const { initializeApp, applicationDefault, getApps } = await import(
    'firebase-admin/app'
  )
  const { getFirestore } = await import('firebase-admin/firestore')
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'aglyn-main',
    })
  }
  const firestore = getFirestore()

  const slugDocs = await firestore.collection('orgSlugs').get()
  const slugs = slugDocs.docs.map((doc) => ({
    slug: doc.id,
    movedTo: doc.get('movedTo') ?? null,
  }))

  const domainsResponse = await vercel(
    `/v9/projects/${PROJECT}/domains${teamQuery}${teamQuery ? '&' : '?'}limit=200`,
  )
  if (!domainsResponse.ok) {
    console.error('Could not list project domains:', domainsResponse.payload)
    process.exit(1)
  }
  const attached = new Set(
    (domainsResponse.payload?.domains ?? []).map((entry) =>
      String(entry.name).toLowerCase(),
    ),
  )

  const expected = slugs.map(({ slug, movedTo }) => ({
    slug,
    movedTo,
    domain: `${slug}.${WORKSPACE_DOMAIN}`.toLowerCase(),
  }))
  const missing = expected.filter((entry) => !attached.has(entry.domain))

  console.log(`orgSlugs docs      : ${expected.length}`)
  console.log(`attached domains   : ${attached.size}`)
  console.log(`missing            : ${missing.length}`)
  for (const entry of missing) {
    console.log(
      `  - ${entry.domain}${entry.movedTo ? `  (tombstone → ${entry.movedTo})` : ''}`,
    )
  }

  // The other direction: a workspace domain attached for a slug that no
  // longer exists keeps resolving to a console for a deleted org, and blocks
  // the slug from being claimed again. Reported, never auto-removed —
  // deleting a domain is not something a reconcile job should decide.
  const expectedDomains = new Set(expected.map((entry) => entry.domain))
  const orphaned = [...attached].filter(
    (domain) =>
      domain.endsWith(`.${WORKSPACE_DOMAIN}`) &&
      !expectedDomains.has(domain) &&
      // Reserved labels are not workspaces and are attached on purpose.
      !['www', 'console', 'app', 'auth'].includes(
        domain.slice(0, -(WORKSPACE_DOMAIN.length + 1)),
      ),
  )
  if (orphaned.length) {
    console.log(`\norphaned (review by hand, NOT auto-removed): ${orphaned.length}`)
    for (const domain of orphaned) console.log(`  - ${domain}`)
  }

  if (!missing.length) {
    console.log('\nNothing to do.')
    return
  }
  if (!COMMIT) {
    console.log('\nDry run — pass --commit to attach the missing domains.')
    return
  }

  let attachedCount = 0
  for (const entry of missing) {
    const result = await vercel(`/v10/projects/${PROJECT}/domains${teamQuery}`, {
      method: 'POST',
      body: JSON.stringify({ name: entry.domain }),
    })
    const code = String(result.payload?.error?.code ?? '')
    if (result.ok || code === 'domain_already_in_use') {
      attachedCount += 1
      console.log(`  attached ${entry.domain}`)
    } else {
      console.error(`  FAILED   ${entry.domain}: ${code || result.status}`)
    }
  }
  console.log(`\nattached ${attachedCount}/${missing.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
