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

// Deploys the Firestore rules using the root .env service
// account via the Firebase Rules REST API — the same createRuleset +
// release-update the CLI performs, without needing `firebase login`
// (useful when the CLI's OAuth session expires, e.g. the
// redirect_uri_mismatch reauth failure). The key never touches disk.
//
//   node tools/scripts/deploy-firestore-rules.mjs
// (self-loads the service account from the repo's local .env files; already-set
// process.env still wins, so `source .env` first is optional.)
//
// What ships is cloud/firebase-firestore.deploy.rules, the documented source
// cloud/firebase-firestore.rules without its comments (AGL-3544): the Rules
// API counts comments toward its 256 KiB limit. Both files must be committed,
// and the artifact must be the one the source builds, or this refuses.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertCleanDeploySource } from './lib/clean-deploy-source.mjs'
import {
  FIRESTORE_RULES_ARTIFACT,
  FIRESTORE_RULES_SOURCE,
  GENERATE_COMMAND,
  judgeRulesArtifact,
} from './lib/rules-deploy-artifact.mjs'
import {
  ALLOW_DIRTY_FLAG,
  parseDeployArgs,
} from './lib/deploy-args.mjs'
import {
  authHeaders,
  getServiceAccountToken,
  loadLocalEnv,
  readServiceAccount,
  rulesApiBase,
} from './lib/firebase-rules-api.mjs'

// Env loading, auth, and REST access are shared with the other deploy
// scripts AND the drift checker (check-rules-drift.mjs) via
// lib/firebase-rules-api.mjs — the reader must never diverge from the
// writer it verifies (AGL-1509).
// Parsed FIRST, before any credential is minted or any file is read: an
// argument this script does not understand must stop it here rather than
// be discarded on the way to a live deploy.
const args = parseDeployArgs({
  command: 'deploy-firestore-rules',
  summary:
    'Deploy cloud/firebase-firestore.deploy.rules (cloud/firebase-firestore.rules without its comments) to the live Firestore project.',
  flags: [ALLOW_DIRTY_FLAG],
})

loadLocalEnv()

// Dirty-tree refusal (AGL-1489): this script deploys the WORKTREE copy of
// the rules file wholesale, so uncommitted edits — including another
// session's work-in-progress — would go live as a silent side effect.
// Refuse unless both files match their committed state; `--allow-dirty` is
// the typed escape hatch for deliberately deploying uncommitted rules.
const repoPath = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const sourcePath = repoPath(FIRESTORE_RULES_SOURCE)
const rulesPath = repoPath(FIRESTORE_RULES_ARTIFACT)
try {
  for (const [path, fileLabel] of [
    [sourcePath, FIRESTORE_RULES_SOURCE],
    [rulesPath, FIRESTORE_RULES_ARTIFACT],
  ]) {
    const verdict = assertCleanDeploySource(path, { allowDirty: args.allowDirty, fileLabel })
    if (verdict.warning) console.warn(verdict.warning)
  }
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

// A stale artifact deploys the OLD rules while the source reads as the new
// ones, so it is refused even under --allow-dirty: regenerating is one
// command, and no deploy wants the mismatch.
try {
  const judgement = judgeRulesArtifact({
    source: readFileSync(sourcePath, 'utf8'),
    artifact: readFileSync(rulesPath, 'utf8'),
  })
  if (judgement.verdict !== 'fresh') {
    console.error(
      `${FIRESTORE_RULES_ARTIFACT} is not the artifact ${FIRESTORE_RULES_SOURCE} builds ` +
        `(first difference on line ${judgement.firstDifferentLine}). Run \`${GENERATE_COMMAND}\`, commit it, and deploy again.`,
    )
    process.exit(1)
  }
} catch (error) {
  console.error(`Cannot confirm ${FIRESTORE_RULES_ARTIFACT} is current: ${error.message}`)
  process.exit(1)
}

const serviceAccount = readServiceAccount()
if (!serviceAccount) {
  console.error('Missing FIREBASE_* service-account env vars (source .env).')
  process.exit(1)
}
const { projectId } = serviceAccount
const token = await getServiceAccountToken(serviceAccount)
const headers = authHeaders(token)
const project = `projects/${projectId}`
const content = readFileSync(rulesPath, 'utf8')

// 1) Create the ruleset — the API compiles it and rejects on errors.
const created = await (
  await fetch(`${rulesApiBase()}/v1/${project}/rulesets`, {
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
  await fetch(`${rulesApiBase()}/v1/${releaseName}`, {
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
