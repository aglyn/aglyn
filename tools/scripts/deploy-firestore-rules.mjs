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

// Deploys cloud/firebase-firestore.rules using the root .env service
// account via the Firebase Rules REST API — the same createRuleset +
// release-update the CLI performs, without needing `firebase login`
// (useful when the CLI's OAuth session expires, e.g. the
// redirect_uri_mismatch reauth failure). The key never touches disk.
//
//   node tools/scripts/deploy-firestore-rules.mjs
// (self-loads the service account from the repo's local .env files; already-set
// process.env still wins, so `source .env` first is optional.)

import { existsSync, readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'

// Load admin creds from the repo's local env files so the script is a single
// self-contained command (matches the backfill scripts). Already-set env wins.
function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  for (const file of roots.flatMap((r) => names.map((n) => `${r}/${n}`))) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}

const app = initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
})
const token = (await app.options.credential.getAccessToken()).access_token
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}
const project = `projects/${projectId}`
const content = readFileSync(
  new URL('../../cloud/firebase-firestore.rules', import.meta.url),
  'utf8',
)

// 1) Create the ruleset — the API compiles it and rejects on errors.
const created = await (
  await fetch(`https://firebaserules.googleapis.com/v1/${project}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: { files: [{ name: 'firebase-firestore.rules', content }] },
    }),
  })
).json()
if (!created.name) {
  console.error('Ruleset create failed:', JSON.stringify(created, null, 2))
  process.exit(1)
}
console.log('Ruleset created:', created.name)

// 2) Point the live cloud.firestore release at it.
const releaseName = `${project}/releases/cloud.firestore`
const updated = await (
  await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      release: { name: releaseName, rulesetName: created.name },
    }),
  })
).json()
if (updated.error) {
  console.error('Release update failed:', JSON.stringify(updated.error))
  process.exit(1)
}
console.log(
  `Live: ${updated.rulesetName ?? created.name} at ${updated.updateTime}`,
)
