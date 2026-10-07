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

// The AI jobs beat for a console on the emulator stack (AGL-3596): what Cloud
// Scheduler does once a minute in production, every few seconds here, and
// only while a job on the emulator is due.
//
//   npm run serve:console:emulated -- --port 4610 --live-ai
//   node tools/scripts/ai-jobs-beat-local.mjs --origin http://localhost:4610
//
// The secret is CRON_SECRET from the shell, else the local one a `--live-ai`
// console verifies (`LOCAL_CRON_SECRET` in lib/emulated-env.mjs). The due
// count is read from FIRESTORE_EMULATOR_HOST, and the script refuses to run
// without it: the pump never reads a production queue.

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  countDueAiJobs,
  startAiJobsBeatPump,
} from './lib/ai-jobs-beat-pump.mjs'
import { LOCAL_CRON_SECRET } from './lib/emulated-env.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const origin = option(
  'origin',
  process.env.E2E_BASE_URL ?? 'http://localhost:4200',
)
const secret = option('secret', process.env.CRON_SECRET || LOCAL_CRON_SECRET)
const everyMs = Number(option('every-ms', '5000'))

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'FIRESTORE_EMULATOR_HOST is not set: the beat pump only reads an emulator queue.',
  )
  process.exit(1)
}
if (!getApps().length)
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main' })
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

console.log(
  `ai jobs beat: ${origin} every ${everyMs} ms while a job is due (Ctrl-C to stop)`,
)
const pump = startAiJobsBeatPump({
  origin,
  secret,
  everyMs,
  due: () => countDueAiJobs(firestore),
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void pump.stop().then(() => process.exit(0))
  })
}
