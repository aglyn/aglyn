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

// Gives already-published images their intrinsic dimensions (AGL-2486).
//
//   set -a && source .env && set +a && \
//     node tools/scripts/backfill-intrinsic-media-size.mjs \
//       [--host=<hostId>] [--apply --project=<projectId>]
//
// DRY RUN BY DEFAULT. A dry run reads and reports; it writes nothing.
//
// `image.tsx` emits `width`/`height` attributes and the media picker copies
// the asset's pixel size onto the node at PICK time, so every image picked
// since that landed reserves its box before its bytes arrive. Nothing already
// on a page does — 45 images on aglyn.com/press, none with a dimension pair —
// and the alternatives were both worse than a backfill: a render-time resolve
// puts one Firestore read per image on the ISR path, and the publish path was
// hardened days earlier around save-refusal semantics a tree rewrite has no
// business being threaded into.
//
// THIS SCRIPT DECIDES NOTHING OF ITS OWN. Every rule lives in
// `libs/tenant/data/admin/src/lib/server/backfill-intrinsic-media-size.ts`,
// which is exercised against the Firestore emulator by
// `backfill-intrinsic-media-size.emulator.spec.ts` — the storage-form round
// trip, the size ceiling, idempotency and every leave-it-alone branch. A
// second implementation here would be a second place for those to be wrong,
// and a `nodes` migration that is wrong is silent (see `backfill-media-refs`
// and `backfill-node-interactions`, both of which say so at length).
//
// ## `--apply` has to name the project
//
// A backfill over every screen, layout, component and template on every host
// is not something to start by getting a flag order wrong. `--apply` is
// refused unless `--project=<id>` matches the project the credential actually
// resolved to, so the target is stated by the operator rather than inherited
// from whatever `.env` happened to be sourced.

import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { importWorkspaceModule } from './lib/workspace-module.mjs'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name) => {
  const found = args.find((arg) => arg.startsWith(`${name}=`))
  return found ? found.slice(name.length + 1) : undefined
}

const APPLY = flag('--apply')
const HOST = opt('--host')
const NAMED_PROJECT = opt('--project')

/**
 * Initialize the firebase-admin default app BEFORE the workspace module is
 * loaded: `libs/**` server modules initialize it on import if the env carries
 * a full credential, and doing it here means this script decides which project
 * it is pointed at rather than inheriting whatever `.env` holds.
 *
 * Returns the project id actually in force, which is what `--apply` is
 * checked against.
 */
function initAdmin() {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    (EMULATED ? 'aglyn-main' : undefined)
  if (getApps().length) return projectId
  if (EMULATED) {
    initializeApp({ projectId })
    return projectId
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
        'FIREBASE_PRIVATE_KEY — `set -a && source .env && set +a` first.',
    )
    process.exit(1)
  }
  initializeApp({
    projectId,
    serviceAccountId: clientEmail,
    credential: cert({ projectId, clientEmail, privateKey }),
  })
  return projectId
}

async function main() {
  const projectId = initAdmin()
  if (APPLY && NAMED_PROJECT !== projectId) {
    console.error(
      `Refusing to write. --apply requires --project=${projectId} — the ` +
        'project this credential resolved to. Say which database you mean.',
    )
    return 1
  }
  const { backfillIntrinsicMediaSize, formatBackfillReport } =
    await importWorkspaceModule(
      'libs/tenant/data/admin/src/lib/server/backfill-intrinsic-media-size.ts',
    )

  console.log(
    `\nBackfill intrinsic media size — project=${projectId} ` +
      `${HOST ? `host=${HOST} ` : ''}mode=${APPLY ? 'APPLY' : 'dry-run'}\n`,
  )
  const report = await backfillIntrinsicMediaSize({
    firestore: getFirestore(process.env.FIRESTORE_DATABASE_ID),
    apply: APPLY,
    hostId: HOST,
    log: (line) => console.log(line),
  })
  console.log(formatBackfillReport(report))
  if (!APPLY) {
    console.log(
      `\nRe-run with --apply --project=${projectId} to write. Running it ` +
        'twice is a no-op: a node that already carries a usable pair is ' +
        'skipped, and a document is only written when a node changed.',
    )
  }
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
