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

// Fails while any App Check DEBUG token is still registered (AGL-2402).
//
//   npm run check:app-check-debug-tokens
//
// Nothing here writes, and nothing here can print a token value — see the
// header of `lib/app-check-debug-tokens.mjs` for why that is structural.
//
// Auth: the authorized-domains checker's exact path — service account from the
// root .env (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY;
// already-set env wins). APP_CHECK_TOKENS_CHECK_ACCESS_TOKEN skips minting,
// e.g. `APP_CHECK_TOKENS_CHECK_ACCESS_TOKEN=$(gcloud auth print-access-token)`.
// Env files are read RELATIVE TO THE CWD, so run from a checkout root.
//
// Exit codes: 0 = none registered; 1 = at least one is (the bypass is live);
// 2 = the check could not be performed.

import {
  fetchApps,
  fetchDebugTokens,
  formatReport,
  summarize,
} from './lib/app-check-debug-tokens.mjs'
import {
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
} from './lib/firebase-rules-api.mjs'

function fail(message) {
  console.error(message)
  process.exit(2)
}

async function main() {
  loadLocalEnv()

  const projectId = process.env.FIREBASE_PROJECT_ID || 'aglyn-main'

  let token = process.env.APP_CHECK_TOKENS_CHECK_ACCESS_TOKEN
  // Only a user credential needs the quota project; see `requestHeaders`.
  const quotaProject = token ? projectId : undefined
  if (!token) {
    const account = readServiceAccount()
    if (!account) {
      fail(
        'No credentials. Set FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /\n' +
          'FIREBASE_PRIVATE_KEY (the root .env already carries them), or set\n' +
          'APP_CHECK_TOKENS_CHECK_ACCESS_TOKEN. Exiting 2 rather than 0: this\n' +
          'check cannot see the live project without them, and a green run that\n' +
          'saw nothing is exactly the standing bypass it exists to catch.',
      )
    }
    try {
      token = await getServiceAccountToken(account)
    } catch (error) {
      fail(`Could not mint an access token: ${error.message}`)
    }
  }

  let apps
  try {
    apps = await fetchApps({ token, projectId, quotaProject })
  } catch (error) {
    fail(`Could not list the project's apps: ${error.message}`)
  }

  if (apps.length === 0) {
    fail(
      `No apps found in ${projectId}. Exiting 2: an empty app list makes the\n` +
        'per-app token search vacuously clean, which is indistinguishable from\n' +
        'a real all-clear and must never be reported as one.',
    )
  }

  const findings = []
  for (const app of apps) {
    try {
      findings.push({
        ...app,
        tokens: await fetchDebugTokens({
          token,
          projectId,
          appId: app.appId,
          quotaProject,
        }),
      })
    } catch (error) {
      fail(`Could not read debug tokens for ${app.appId}: ${error.message}`)
    }
  }

  const summary = summarize(findings)
  console.log(formatReport(summary, { projectId }))
  process.exit(summary.ok ? 0 : 1)
}

main().catch((error) => {
  fail(`Unexpected failure: ${error?.stack ?? error}`)
})
