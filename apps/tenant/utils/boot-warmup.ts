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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Boot-time Firestore warm-up (AGL-1500) — the body `instrumentation.ts`
 * runs on the nodejs runtime.
 *
 * A separate module for one reason: the nx boundary lint treats a workspace
 * lib that is ever `import()`ed as lazy-loaded EVERYWHERE, so a dynamic
 * import of `@aglyn/tenant-data-admin` straight from `instrumentation.ts`
 * flagged every static import of the lib across the app. The lib is imported
 * STATICALLY here; `instrumentation.ts` dynamically imports this file by
 * relative path instead, which keeps firebase-admin out of the edge bundle
 * without creating a lib-level lazy edge.
 *
 * What it does and why — see `instrumentation.ts`, whose docblock carries the
 * measurements. Short form: the first render of a fresh instance paid every
 * Firestore phase at 3–6× warm cost (AGL-1152's production read), and that
 * penalty is shared transport establishment, not the queries. Paying it here,
 * during function initialisation, takes it off the first visitor's TTFB.
 */
export function warmFirestoreAtBoot(): void {
  // Operational kill switch: set AGLYN_DISABLE_BOOT_WARMUP=1 in the Vercel
  // env to restore the previous behavior (lazy gRPC establishment inside the
  // first request) WITHOUT a revert deploy. `preferRest` changes transport
  // for every Firestore call in the process, so if REST ever misbehaves in
  // production this is the fast way out. Also what the local A/B measurement
  // used for its baseline arm.
  if (process.env.AGLYN_DISABLE_BOOT_WARMUP === '1') return

  const uptimeAtRegisterMs = Math.round(process.uptime() * 1000)
  const firestore = firebaseAdmin.app().firestore()

  try {
    // REST skips gRPC client construction on first use (measured: ~260 ms
    // median first read over gRPC with 410/523 ms tails, ~220 ms over REST
    // with none; steady state identical). `getFirestore` memoises per
    // app+database, so the setting sticks to the instance every later
    // `firebaseAdmin.app().firestore()` call returns. The SDK still creates
    // a gRPC client transparently if a streaming call ever asks for one —
    // none exists in the tenant server tree today.
    firestore.settings({ preferRest: true })
  } catch {
    // `settings()` throws if the instance has already been used (dev-server
    // reloads re-run register against a live process). The warm read below
    // is still worth firing; only the transport choice is forfeit.
  }

  const warmStartedAt = Date.now()
  // The same key-only projection shape `getHost` issues. Fire-and-forget:
  // returning fast keeps boot unchanged, and BOTH outcomes are consumed so a
  // Firestore outage at boot logs one line instead of crashing the instance.
  // Cost: one billed read per instance boot — tens per day, noise against
  // the per-render fan-out AGL-1302 measured.
  void firestore
    .collection('hosts')
    .select()
    .limit(1)
    .get()
    .then(() => {
      console.log(
        JSON.stringify({
          tag: 'AGL-1500:boot',
          uptimeAtRegisterMs,
          warmReadMs: Date.now() - warmStartedAt,
          ok: true,
        }),
      )
    })
    .catch((error: unknown) => {
      console.log(
        JSON.stringify({
          tag: 'AGL-1500:boot',
          uptimeAtRegisterMs,
          warmReadMs: Date.now() - warmStartedAt,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    })
}
