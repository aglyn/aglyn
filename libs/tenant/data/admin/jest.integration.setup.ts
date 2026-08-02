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
 * Point the Admin SDK at the emulator, and initialise the default app BEFORE
 * anything imports it (AGL-958).
 *
 * Both halves matter. `FIRESTORE_EMULATOR_HOST` is what lets the Admin SDK
 * connect with no credentials at all — which is the whole reason these tests
 * can run under jest, where real ADC dies in google-auth-library ("Getting
 * metadata from plugin failed") because gRPC auth does not survive the jest
 * sandbox.
 *
 * And `@aglyn/shared-util-fbserver` initialises on module load, but only when
 * `FIREBASE_PRIVATE_KEY` is present — absent, it returns early and never
 * creates an app, so `firebaseAdmin.app()` would throw. Its first branch is
 * `if (getApps().length) { adopt it }`, so creating the app here hands it a
 * ready one instead of a missing key.
 */
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8082'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? 'aglyn-main'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initializeApp, getApps } = require('firebase-admin/app')
if (!getApps().length) initializeApp({ projectId: 'aglyn-main' })
