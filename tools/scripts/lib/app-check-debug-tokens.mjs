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

// Is any App Check DEBUG token still registered on a live Firebase app?
// (AGL-2402.)
//
// ## Why this exists, when a spec already guards the repo
//
// `libs/aglyn/src/lib/app-utils/app-check-debug-token.spec.ts` pins the repo
// half: no build may READ a debug token. That is necessary and it is not
// sufficient, because a debug token is not a repo artifact. It is a row in the
// Firebase console, created by a click, deleted by a click, and recorded
// nowhere in git — the same shape as the authorized-domain allowlist that
// drifted four separate times (see `check-authorized-domains.mjs`).
//
// A registered debug token is a STANDING BYPASS of App Check attestation for
// whoever holds its value. It keeps working no matter what the repo does, no
// matter what Vercel holds, and no matter whether any code reads it: the
// holder POSTs the value to `…:exchangeDebugToken` and receives a real
// attestation token. Measured 2026-08-24 against `aglyn-main`: App Check is
// ENFORCED on Firestore, Storage, Identity Toolkit and Realtime Database, so
// there is a live gate for such a token to walk through.
//
// So "we deleted them" is a claim about console state that nothing could
// check. This checks it.
//
// ## It cannot leak a token, by construction
//
// `debugTokens.list` does not return token values — the `token` field is
// write-only in the App Check API, and a list response carries only `name`,
// `displayName`, `updateTime` and `etag`. This file therefore has no value to
// suppress, no decrypt flag to avoid, and no redaction to get wrong. That is a
// property of the endpoint, not a discipline of this code, which is why it is
// stated here rather than enforced below.
//
// ## Exit codes — cannot-check must NEVER masquerade as clean
//
//   0  no debug token is registered on any app
//   1  at least one is registered (the bypass is live)
//   2  the check could not be performed

/**
 * Request headers.
 *
 * `quotaProject` sets `x-goog-user-project`, which a USER credential (an ADC
 * token from `gcloud auth print-access-token`) must send or both APIs answer
 * 403 SERVICE_DISABLED — the message blames a disabled service, but the cause
 * is a missing quota project, and it is the first thing anyone reaching for
 * the documented gcloud shortcut will hit. A service-account credential
 * carries its own project and must NOT send it, since that would additionally
 * require `serviceusage.services.use`.
 */
export function requestHeaders(token, quotaProject) {
  return {
    Authorization: `Bearer ${token}`,
    ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}),
  }
}

/** Firebase Management: every app in the project, all platforms. */
export function searchAppsUrl(projectId) {
  return `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(
    projectId,
  )}:searchApps?pageSize=200`
}

/** App Check: the debug tokens registered against one app. */
export function debugTokensUrl(projectId, appId) {
  return `https://firebaseappcheck.googleapis.com/v1/projects/${encodeURIComponent(
    projectId,
  )}/apps/${encodeURIComponent(appId)}/debugTokens`
}

/**
 * Every app in the project.
 *
 * Deliberately NOT just the web app. App Check registers per app, and a debug
 * token on any of them is a bypass; enumerating one platform would report
 * "clean" while a token sat on another. The known state of `aglyn-main` is a
 * single WEB app, but the check must not encode that, or it stops being able
 * to notice a second one appearing.
 */
export async function fetchApps({
  token,
  projectId,
  quotaProject,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(searchAppsUrl(projectId), {
    headers: requestHeaders(token, quotaProject),
  })
  if (!response.ok) {
    throw new Error(
      `searchApps ${response.status}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  const body = await response.json()
  return (body.apps ?? []).map((app) => ({
    appId: app.appId,
    displayName: app.displayName ?? '(unnamed)',
    platform: app.platform ?? 'UNKNOWN',
  }))
}

/**
 * The debug tokens registered against one app — metadata only; see the header.
 */
export async function fetchDebugTokens({
  token,
  projectId,
  appId,
  quotaProject,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(debugTokensUrl(projectId, appId), {
    headers: requestHeaders(token, quotaProject),
  })
  if (!response.ok) {
    throw new Error(
      `debugTokens ${response.status}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  const body = await response.json()
  return (body.debugTokens ?? []).map((entry) => ({
    // The trailing segment of `name` is the token's RESOURCE id, which is what
    // the console shows next to the row. It is not the token value.
    id:
      String(entry.name ?? '')
        .split('/')
        .pop() ?? '',
    displayName: entry.displayName ?? '(unnamed)',
    updateTime: entry.updateTime ?? '',
  }))
}

/**
 * Fold per-app findings into a verdict.
 *
 * Pure, and separated from the fetching for the reason the rules-drift lib
 * separates its comparison: the verdict is the part that can be wrong, and it
 * must be exercisable without a live project or a registered bypass.
 */
export function summarize(findings) {
  const offenders = findings.filter((app) => app.tokens.length > 0)
  const total = offenders.reduce((sum, app) => sum + app.tokens.length, 0)
  return { ok: offenders.length === 0, offenders, total, apps: findings.length }
}

export function formatReport(summary, { projectId }) {
  if (summary.ok) {
    return (
      `No App Check debug token is registered in ${projectId} ` +
      `(${summary.apps} app(s) checked).`
    )
  }
  const lines = [
    `${summary.total} App Check DEBUG token(s) are still registered in ` +
      `${projectId} — each one is a live bypass of App Check attestation.`,
    '',
  ]
  for (const app of summary.offenders) {
    lines.push(`  ${app.platform} ${app.displayName} (${app.appId})`)
    for (const entry of app.tokens) {
      lines.push(
        `    - "${entry.displayName}"  last updated ${entry.updateTime}`,
      )
    }
  }
  lines.push(
    '',
    'Delete them: Firebase console -> App Check -> Apps -> the app above ->',
    'the three-dot menu -> Manage debug tokens -> delete every row.',
    'Revoke there FIRST; removing the Vercel variables while a token stays',
    'registered leaves the bypass live and only hides the evidence (AGL-2402).',
  )
  return lines.join('\n')
}
