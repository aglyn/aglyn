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

// Fails when the media bucket's upload-CORS origins differ from the set DERIVED
// from the console's attached Vercel domains (AGL-1452).
//
//   npm run check:upload-cors            # report only; writes nothing
//   npm run check:upload-cors -- --fix   # merge the missing origins in
//   npm run check:upload-cors -- --prune # ALSO remove origins nothing serves
//
// WHY A DERIVED CHECK AND NOT A CHECKLIST LINE. GCS matches the CORS `origin`
// list as an exact string, so every serving console name needs its own entry
// and there is no wildcard that can stand in for a family. A hand-maintained
// list of those is a process that gets forgotten, and its failure is invisible:
// only files over SIGNED_UPLOAD_THRESHOLD_BYTES take the direct-to-GCS path, so
// a missing origin breaks video, PDF and ZIP only, behind a generic "try again"
// snackbar that points nowhere near bucket configuration.
//
// The list therefore is not maintained — it is DERIVED, from the same Vercel
// project-domains resource that `attachProjectDomain` writes to. A name cannot
// serve the console without being there.
//
// Auth:
//   VERCEL_TOKEN, or the Vercel CLI's own auth.json (same fallback as
//   check:firewall-posture).
//   Google: UPLOAD_CORS_ACCESS_TOKEN, else the service account from the root
//   .env (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY),
//   the rules checker's exact path. Env files are read RELATIVE TO THE CWD, so
//   run from a checkout root.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  the bucket permits exactly the derived serving origins
//   1  drift (missing origins, stale origins, or a wildcard)
//   2  cannot check: no credential, an API refusal, a failed write

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  loadLocalEnv,
  getServiceAccountToken,
  readServiceAccount,
  resolveStorageBucket,
  credentialFailureMessage,
} from './lib/firebase-rules-api.mjs'
import {
  CONSOLE_PROJECT,
  TEAM_SCOPE,
  compareUploadCors,
  fetchBucketCors,
  fetchProjectDomains,
  formatReport,
  mergeUploadOrigins,
  pruneUploadOrigins,
  uploadOriginFor,
  writeBucketCors,
} from './lib/upload-cors-drift.mjs'

const argv = process.argv.slice(2)
const wants = (flag) => argv.includes(flag)

/**
 * The Vercel token: the env var first, then the CLI's own auth file — the same
 * order `check:firewall-posture` uses, so an operator who has run `vercel login`
 * never has to mint a second token to run a read-only check.
 */
function vercelToken() {
  const fromEnv = process.env.VERCEL_TOKEN?.trim()
  if (fromEnv) return fromEnv
  for (const path of [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
  ]) {
    try {
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (token) return String(token)
    } catch {
      // Absent or unreadable is not an error here; the next candidate may work,
      // and running out of candidates is reported once, below, with a fix.
    }
  }
  return null
}

/** Exit 2 with a sentence that names the variable to set. Never exit 1. */
function cannotCheck(message) {
  console.error(`\n[upload-cors] CANNOT CHECK — no verdict was produced.\n${message}\n`)
  process.exit(2)
}

async function googleToken() {
  const direct = process.env.UPLOAD_CORS_ACCESS_TOKEN?.trim()
  if (direct) return direct
  const account = readServiceAccount()
  if (!account?.privateKey || !account?.clientEmail || !account?.projectId) {
    cannotCheck(
      'No Google credential. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and\n' +
        'FIREBASE_PRIVATE_KEY (the root .env already carries them), or set\n' +
        '  UPLOAD_CORS_ACCESS_TOKEN=$(gcloud auth application-default print-access-token)',
    )
  }
  try {
    return await getServiceAccountToken(account)
  } catch (error) {
    cannotCheck(credentialFailureMessage(error, account))
  }
}

async function main() {
  loadLocalEnv()

  const token = vercelToken()
  if (!token) {
    cannotCheck(
      'No Vercel API token, so the required origin set cannot be DERIVED — and a\n' +
        'check that cannot derive its expectation has no expectation to compare.\n' +
        'Set VERCEL_TOKEN, or run `vercel login`.',
    )
  }

  const account = readServiceAccount()
  const projectId = account?.projectId || process.env.FIREBASE_PROJECT_ID || 'aglyn-main'
  const bucket = resolveStorageBucket(projectId)
  const google = await googleToken()

  let domains
  try {
    domains = await fetchProjectDomains({ token, project: CONSOLE_PROJECT, teamId: TEAM_SCOPE })
  } catch (error) {
    cannotCheck(String(error?.message ?? error))
  }

  let live
  try {
    live = await fetchBucketCors({ token: google, bucket })
  } catch (error) {
    cannotCheck(
      `${error?.message ?? error}\n\n` +
        'A read needs `storage.buckets.get` on the bucket; the --fix write needs\n' +
        '`storage.buckets.update` as well.',
    )
  }

  // The platform origin is configured, not provisioned. It must never be pruned
  // even if it somehow fell off the project's domain list: removing it breaks
  // large uploads for every customer at once.
  const platformOrigin =
    uploadOriginFor(process.env.NEXT_PUBLIC_CONSOLE_URL || 'app.aglyn.com') ?? null

  let result = compareUploadCors({ domains, rules: live.rules, platformOrigin })
  console.log(formatReport(result, { bucket }))

  const doFix = wants('--fix')
  const doPrune = wants('--prune')
  if (!doFix && !doPrune) {
    if (result.missing.length > 0 || result.stale.length > 0 || result.wildcard) {
      console.log(
        '\nRun with --fix to add the missing origins. Adding is safe and additive;\n' +
          'removing is not, so --prune is separate and deliberate.',
      )
      process.exit(1)
    }
    process.exit(0)
  }

  // Read-modify-WRITE, every time, conditional on the metageneration just read.
  let rules = live.rules
  const added = []
  const removed = []

  if (doFix && result.missing.length > 0) {
    const merged = mergeUploadOrigins(rules, result.missing.map((entry) => entry.origin))
    rules = merged.rules
    added.push(...merged.added)
  }
  if (doPrune) {
    const prunable = result.stale.filter((entry) => !entry.protected).map((e) => e.origin)
    if (prunable.length > 0) {
      const pruned = pruneUploadOrigins(rules, prunable, {
        keep: platformOrigin ? [platformOrigin] : [],
      })
      rules = pruned.rules
      removed.push(...pruned.removed)
    }
  }

  if (added.length === 0 && removed.length === 0) {
    console.log('\nNothing to write.')
    process.exit(result.missing.length > 0 || result.stale.length > 0 ? 1 : 0)
  }

  try {
    await writeBucketCors({
      token: google,
      bucket,
      rules,
      metageneration: live.metageneration,
    })
  } catch (error) {
    cannotCheck(
      `The bucket was NOT updated.\n${error?.message ?? error}\n\n` +
        'Nothing partial was written — the PATCH is a single conditional call.',
    )
  }

  console.log(
    `\nWrote gs://${bucket} (from metageneration ${live.metageneration}).` +
      (added.length ? `\n  added:   ${added.join('\n           ')}` : '') +
      (removed.length ? `\n  removed: ${removed.join('\n           ')}` : ''),
  )
  console.log(
    '\nA config read-back is NOT proof. Drive a real preflight:\n' +
      `  curl -sI -X OPTIONS https://storage.googleapis.com/${bucket}/probe \\\n` +
      "    -H 'Origin: <the origin>' -H 'Access-Control-Request-Method: PUT' | grep -i access-control",
  )

  // Re-derive against what we just wrote, so the exit code describes the bucket
  // as it now stands rather than as it was found.
  result = compareUploadCors({ domains, rules, platformOrigin })
  process.exit(result.missing.length > 0 || result.stale.length > 0 || result.wildcard ? 1 : 0)
}

main().catch((error) => {
  cannotCheck(String(error?.stack ?? error))
})
