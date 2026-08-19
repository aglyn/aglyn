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

// Fails when the LIVE Firebase Auth authorized-domain allowlist differs from
// `cloud/firebase-auth-domains.json` (AGL-1940).
//
//   npm run check:authorized-domains
//   npm run check:authorized-domains -- --file=/tmp/doctored.json
//
// Nothing here writes. One GET against the Identity Platform config resource.
//
// WHY A CHECKER AND NOT A CODE REVIEW. This list has no deploy step. It is
// edited in a console UI, so nothing in git ever records a change to it and
// no PR can review one. Four issues are the same drift found by hand, months
// apart: AGL-1135 (a `*.aglyn.com` wildcard), AGL-1344 (bare `vercel.app`,
// trusting every project on the platform), AGL-1486 (four dead `aglyn.io`
// redirect URIs) and AGL-1940 (`aglyn-console.vercel.app`, a hostname in a
// namespace we do not control — Vercel hands out `<project>.vercel.app` by
// project NAME, and that name is not ours).
//
// An authorized domain is what Firebase checks before letting a page run the
// OAuth handshake, so a stale entry on a hostname somebody else can claim is
// an account-takeover vector. The list only ever grows by hand, and nobody
// re-reads it, so it only ever grows.
//
// Auth: the rules checker's exact path — service account from the root .env
// (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY;
// self-loaded, already-set env wins). AUTH_DOMAINS_CHECK_ACCESS_TOKEN skips
// minting (e.g. `AUTH_DOMAINS_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token)`).
// Env files are read RELATIVE TO THE CWD, so run from a checkout root.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  live matches the file
//   1  drift (re-added, live-only or file-only)
//   2  cannot check: no credentials, unreadable/invalid file, API refusal

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compareAuthorizedDomains,
  fetchLiveAuthorizedDomains,
  formatReport,
  parseInventory,
} from './lib/authorized-domains.mjs'
import {
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
} from './lib/firebase-rules-api.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const fileArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--file='))
  ?.slice('--file='.length)

const inventoryPath =
  fileArg ?? join(repoRoot, 'cloud/firebase-auth-domains.json')

function fail(message) {
  console.error(message)
  process.exit(2)
}

async function main() {
  let inventory
  try {
    inventory = parseInventory(JSON.parse(readFileSync(inventoryPath, 'utf8')))
  } catch (error) {
    fail(`Cannot read ${inventoryPath}: ${error.message}`)
  }

  loadLocalEnv()

  const projectId =
    inventory.projectId || process.env.FIREBASE_PROJECT_ID || 'aglyn-main'

  let token = process.env.AUTH_DOMAINS_CHECK_ACCESS_TOKEN
  if (!token) {
    const account = readServiceAccount()
    if (!account) {
      fail(
        'No credentials. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /\n' +
          'FIREBASE_PRIVATE_KEY (the root .env already carries them), or set\n' +
          'AUTH_DOMAINS_CHECK_ACCESS_TOKEN. Exiting 2 rather than 0: this check\n' +
          'cannot see live without them, and a green run that saw nothing is the\n' +
          'exact silent drift it exists to catch.',
      )
    }
    try {
      token = await getServiceAccountToken(account)
    } catch (error) {
      fail(`Could not mint an access token: ${error.message}`)
    }
  }

  let live
  try {
    live = await fetchLiveAuthorizedDomains({ token, projectId })
  } catch (error) {
    fail(`Could not read the live allowlist: ${error.message}`)
  }

  const result = compareAuthorizedDomains({
    expected: inventory.expected,
    live,
    removed: inventory.removed,
  })

  console.log(`live      (${live.length}): ${live.join(', ')}`)
  console.log(
    `approved  (${inventory.expected.length}): ${inventory.expected.join(', ')}`,
  )
  console.log('')
  console.log(formatReport(result, { stale: inventory.stale, projectId }))

  process.exit(result.ok ? 0 : 1)
}

main().catch((error) => {
  fail(`Unexpected failure: ${error?.stack ?? error}`)
})
