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
 * What a staff reviewer must actually do before a plugin carries the
 * verified badge (AGL-963).
 *
 * These exist because the static verifier cannot carry review on its own.
 * It matches source TEXT with regexes, so `g['ev'+'al'](…)`,
 * `(()=>{}).constructor('return 1')()` and `import(someVariable)` all pass
 * it, and a plain `fetch()` exfiltrating page data was never checked at
 * all. What contains a hostile plugin is the sandbox iframe, the
 * per-manifest CSP, sha pinning and the kill switch — plus a human, for the
 * realm tier where the first two no longer apply.
 *
 * Every item here is therefore something static analysis STRUCTURALLY
 * cannot do: judge intent, compare code against its stated purpose, or
 * confirm the publisher is who they claim. Items that a machine could check
 * belong in the verifier instead, not on this list.
 */
export interface ReviewChecklistItem {
  id: string
  label: string
  /** Why it matters — shown under the item, not hidden in a tooltip. */
  detail: string
  /** Required items gate the Verify verdict. */
  required: boolean
  /** Additionally required before granting realm trust. */
  realmOnly?: boolean
}

export const PLUGIN_REVIEW_CHECKLIST: readonly ReviewChecklistItem[] = [
  {
    id: 'provenance',
    label: 'Repository resolves and plausibly matches the bundle',
    detail:
      'Open the declared repository. It should exist, be public, and contain a plugin that could have produced this bundle. A listing whose repo 404s or has nothing to do with the code is the cheapest tell there is.',
    required: true,
  },
  {
    id: 'publisher',
    label: 'Publisher is identifiable and contactable',
    detail:
      'A real workspace with a history, not an account created this week. Publisher identity is what makes takedown and liability meaningful.',
    required: true,
  },
  {
    id: 'capabilities',
    label: 'Declared capabilities are minimal and justified by the README',
    detail:
      'Every declared network host becomes CSP connect-src for this plugin. A widget that renders a countdown does not need a network allowlist. Undeclared hosts are blocked, so over-declaration is the risk to look for.',
    required: true,
  },
  {
    id: 'source-read',
    label: 'Bundle source read, not just the verifier verdict',
    detail:
      'The verifier flags computed access on a global, string-built identifiers, base64 blobs and undeclared network calls — read the code for what it cannot flag: what the plugin is actually FOR, and whether the data it touches is any of its business.',
    required: true,
  },
  {
    id: 'diff',
    label: 'Changes since the last approved version reviewed',
    detail:
      'An update is the natural place to slip something in — the first version gets read closely, the fourth rarely does. For a first submission, tick this once you have read the whole bundle.',
    required: true,
  },
  {
    id: 'behaviour',
    label: 'Installed on a throwaway site and exercised',
    detail:
      'Static review cannot show you what it does at runtime. Install it somewhere disposable, use it, and watch the network tab.',
    required: true,
  },
  {
    id: 'data',
    label: 'Data handling matches what the listing claims',
    detail:
      'If it collects anything, the README should say so. Check for host-mediated fetches carrying page or member data to an origin that has no business receiving it.',
    required: true,
  },
  {
    id: 'license',
    label: 'License present and acceptable',
    detail:
      'Missing or incompatible licensing is a legal problem for every workspace that installs it, not just for us.',
    required: true,
  },
  {
    id: 'realm-need',
    label: 'Realm access is genuinely necessary',
    detail:
      'Realm trust drops this code into the app realm, where the sandbox iframe and CSP no longer separate it from user data. Sandbox is the default; realm needs a reason you could defend afterwards.',
    required: false,
    realmOnly: true,
  },
  {
    id: 'support',
    label: 'Changelog and support contact present',
    detail:
      'Not a security control — an operational one. When a plugin misbehaves in production, this is how it gets fixed instead of revoked.',
    required: false,
  },
]

export const REQUIRED_CHECKLIST_IDS = PLUGIN_REVIEW_CHECKLIST.filter(
  (item) => item.required,
).map((item) => item.id)

/** A stored tick: who, when, and against which bytes. */
export interface ChecklistEntry {
  by?: string
  at?: unknown
  sha256?: string
}

/**
 * Which required items are still outstanding for a given bundle.
 *
 * Ticks are keyed to the version's sha256 on purpose: a checklist is a
 * statement about specific bytes, so a republish under the same version
 * string invalidates it exactly like it invalidates the verifier verdict
 * (AGL-962). Silently carrying ticks across a rebuild would let a publisher
 * inherit someone else's review.
 */
export function outstandingChecklistItems(
  checklist: Record<string, ChecklistEntry> | null | undefined,
  sha256: string,
): string[] {
  return REQUIRED_CHECKLIST_IDS.filter(
    (id) => checklist?.[id]?.sha256 !== sha256 || !sha256,
  )
}
