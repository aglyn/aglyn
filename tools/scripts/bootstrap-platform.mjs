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

// One-command managed-platform bootstrap. Aglyn is a managed service —
// customer workspaces never touch infrastructure; this script is how OUR operators
// spin up / converge the shared platform:
//
//   node tools/scripts/bootstrap-platform.mjs [--apply]
//
// Sections run independently and skip (with instructions) when their
// credentials are absent, so a partial environment still converges what it
// can. Without --apply it's a dry run that reports what would happen.
//
//   1. Firebase security rules + indexes  (needs `firebase` CLI login or
//      GOOGLE_APPLICATION_CREDENTIALS, and FIREBASE_PROJECT_ID)
//   2. Stripe products/prices/webhook     (needs STRIPE_SECRET_KEY;
//      delegates to setup-stripe.mjs)
//   3. Vercel env sync                    (needs VERCEL_TOKEN and
//      VERCEL_CONSOLE_PROJECT_ID / VERCEL_TENANT_PROJECT_ID)
//   4. Staff claim grant                  (--staff <uid-or-email>; needs
//      FIREBASE_* admin envs; delegates to set-staff-claim.mjs)

import { execSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const staffIndex = args.indexOf('--staff')
const staffTarget = staffIndex !== -1 ? args[staffIndex + 1] : undefined

const results = []
const section = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`\n[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 1. Firebase rules + indexes ────────────────────────────────────────────
{
  const projectId = process.env.FIREBASE_PROJECT_ID
  let cliAvailable = false
  try {
    execSync('npx --no-install firebase --version', {
      cwd: root,
      stdio: 'pipe',
    })
    cliAvailable = true
  } catch {
    /* not installed */
  }
  if (!projectId) {
    section('Firebase rules', 'SKIP', 'set FIREBASE_PROJECT_ID')
  } else if (!cliAvailable) {
    section(
      'Firebase rules',
      'SKIP',
      'firebase-tools not installed (npm i -D firebase-tools)',
    )
  } else if (!APPLY) {
    section(
      'Firebase rules',
      'DRY',
      `would deploy firestore:rules, firestore:indexes, storage to ${projectId}`,
    )
  } else {
    const deploy = spawnSync(
      'npx',
      [
        'firebase',
        'deploy',
        '--only',
        'firestore:rules,firestore:indexes,storage',
        '--project',
        projectId,
        '--non-interactive',
      ],
      { cwd: join(root, 'cloud'), stdio: 'inherit' },
    )
    section(
      'Firebase rules',
      deploy.status === 0 ? 'OK' : 'FAIL',
      deploy.status === 0 ? undefined : `exit ${deploy.status}`,
    )
  }
}

// ── 2. Stripe ──────────────────────────────────────────────────────────────
{
  if (!process.env.STRIPE_SECRET_KEY) {
    section('Stripe products/prices', 'SKIP', 'set STRIPE_SECRET_KEY')
  } else if (!APPLY) {
    section('Stripe products/prices', 'DRY', 'would run setup-stripe.mjs')
  } else {
    const stripe = spawnSync(
      'node',
      [
        join(root, 'tools/scripts/setup-stripe.mjs'),
        ...(process.env.STRIPE_WEBHOOK_URL
          ? ['--webhook-url', process.env.STRIPE_WEBHOOK_URL]
          : []),
      ],
      { stdio: 'inherit', env: process.env },
    )
    section(
      'Stripe products/prices',
      stripe.status === 0 ? 'OK' : 'FAIL',
    )
  }
}

// ── 3. Vercel env sync ─────────────────────────────────────────────────────

/**
 * Which environments a key may be written to (AGL-2401).
 *
 * This block used to send EVERY key to `['production', 'preview']`. A Vercel
 * env var is one record with one value and a `target` array, so that single
 * line is what put the live `STRIPE_SECRET_KEY`, the live
 * `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY` and a
 * `VERCEL_TOKEN` into preview with the production value — identical by
 * construction, not by anyone pasting them twice.
 *
 * That matters beyond the one-off cleanup AGL-2401 and AGL-2403 describe: a
 * bootstrap is re-runnable and is what a self-host operator runs too, so
 * leaving this line alone would silently re-create the condition the moment
 * anyone ran it again after the rotation.
 *
 * DENY BY DEFAULT. A key reaches preview only if it is named below with a
 * reason, because the two failure directions are not symmetric:
 *
 *   wrongly production-only -> a preview build lacks a setting. Visible,
 *                              harmless, one edit to fix.
 *   wrongly shared          -> a production credential is live in an
 *                              environment with a weaker deployment gate, and
 *                              nothing about it looks wrong.
 *
 * Nothing here is ever written to `development`: that target is what
 * `vercel env pull` hands a laptop, and no value this script holds belongs in
 * a file on a developer's machine.
 */
const SHARED_WITH_PREVIEW = {
  AGLYN_TENANT_HOST_CNAME: 'a CNAME hostname — public DNS, authorizes nothing',
  NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME: 'the same hostname, already inlined into the client bundle',
  AGLYN_TENANT_DEMO: 'the demo site identifier',
  STRIPE_METER_EVENT_NAME: 'a meter event name — a label, not a credential',
  VERCEL_TEAM_ID: 'an account identifier, visible in every dashboard URL',
  VERCEL_TENANT_PROJECT_ID: 'a project identifier',
}

/**
 * `STRIPE_PRICE_*` is deliberately absent from the list above even though a
 * price id is not secret: a price id belongs to ONE Stripe mode, so a live
 * price id in a preview running a test-mode key resolves to a plausible id
 * that no test-mode call can use. Production-only keeps the mode consistent.
 */
const envTarget = (key) => (SHARED_WITH_PREVIEW[key] ? ['production', 'preview'] : ['production'])

{
  const token = process.env.VERCEL_TOKEN
  const teamQuery = process.env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
    : ''
  const targets = [
    {
      project: process.env.VERCEL_CONSOLE_PROJECT_ID,
      label: 'console',
      keys: [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_PRICE_STARTER',
        'STRIPE_PRICE_PRO',
        'STRIPE_PRICE_BUSINESS',
        'AGLYN_TENANT_HOST_CNAME',
        'NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME',
        'ANTHROPIC_API_KEY',
        'CRON_SECRET',
        'STRIPE_METER_EVENT_NAME',
        'VERCEL_TOKEN',
        'VERCEL_TENANT_PROJECT_ID',
        'VERCEL_TEAM_ID',
      ],
    },
    {
      project: process.env.VERCEL_TENANT_PROJECT_ID,
      label: 'tenant',
      keys: ['AGLYN_TENANT_HOST_CNAME', 'AGLYN_TENANT_DEMO'],
    },
  ]
  if (!token) {
    section('Vercel env sync', 'SKIP', 'set VERCEL_TOKEN')
  } else {
    for (const { project, label, keys } of targets) {
      if (!project) {
        section(
          `Vercel env (${label})`,
          'SKIP',
          `set VERCEL_${label.toUpperCase()}_PROJECT_ID`,
        )
        continue
      }
      const present = keys.filter((key) => process.env[key])
      // Name the split in the output. The whole defect this replaced was
      // invisible precisely because the summary only ever counted variables.
      const shared = present.filter((key) => SHARED_WITH_PREVIEW[key])
      const spread = `${present.length - shared.length} production-only, ${shared.length} +preview`
      if (!APPLY) {
        section(
          `Vercel env (${label})`,
          'DRY',
          `would upsert ${present.length}/${keys.length} vars (${spread})`,
        )
        continue
      }
      let failures = 0
      for (const key of present) {
        const response = await fetch(
          `https://api.vercel.com/v10/projects/${project}/env${teamQuery}${teamQuery ? '&' : '?'}upsert=true`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              key,
              value: process.env[key],
              type: key.startsWith('NEXT_PUBLIC_') ? 'plain' : 'encrypted',
              target: envTarget(key),
            }),
          },
        )
        if (!response.ok) failures += 1
      }
      section(
        `Vercel env (${label})`,
        failures ? 'FAIL' : 'OK',
        `${present.length - failures}/${present.length} vars upserted (${spread})`,
      )
    }
  }
}

// ── 4. Staff claim ─────────────────────────────────────────────────────────
{
  if (!staffTarget) {
    section('Staff claim', 'SKIP', 'pass --staff <uid-or-email> to grant')
  } else if (!APPLY) {
    section('Staff claim', 'DRY', `would grant staff to ${staffTarget}`)
  } else {
    const claim = spawnSync(
      'node',
      [join(root, 'tools/scripts/set-staff-claim.mjs'), staffTarget],
      { stdio: 'inherit', env: process.env },
    )
    section('Staff claim', claim.status === 0 ? 'OK' : 'FAIL')
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n── bootstrap summary ──')
for (const { name, status, detail } of results) {
  console.log(`${status.padEnd(4)} ${name}${detail ? ` — ${detail}` : ''}`)
}
if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to make changes.')
}
if (
  !existsSync(join(root, 'cloud/firebase-firestore.rules')) ||
  !existsSync(join(root, 'cloud/firebase-storage.rules'))
) {
  console.warn('WARNING: rules files missing from cloud/ — check the repo.')
}
