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

// The Firestore TTL policies the platform expects, in a module with NO side
// effects so a guard can import them (AGL-2014).
//
// They used to live inline in `set-firestore-ttl.mjs`, which authenticates and
// calls the Firestore Admin API at import time — unimportable, therefore
// untestable, therefore free to drift. And it did: the script carried one
// policy while `docs/FIRESTORE_MANUAL_CONFIG.md` recorded eight — five ACTIVE
// and three declared-and-owed. The four missing ACTIVE ones were applied to
// `aglyn-main` by hand with `gcloud` and never came back to the script. On the
// cloud project the drift was invisible (those policies were already ACTIVE);
// on a self-host install the script is the only reproducible way to get TTL at
// all, and it delivered one policy out of eight.
//
// `ttl-policies.test.mjs` re-derives this list from the doc's table and fails
// on any disagreement, in either direction.

/**
 * Collections whose documents expire, and the timestamp field to expire on.
 *
 * Ordered as the doc's table orders them, so a diff between the two reads
 * cleanly.
 *
 * @type {ReadonlyArray<{ collection: string, field: string, why: string }>}
 */
export const TTL_POLICIES = Object.freeze([
  {
    collection: 'rateLimits',
    field: 'expiresAt',
    // AGL-794/795 — one document per (hashed key, window). Without a policy
    // these accumulate at roughly one per caller per minute, forever.
    why: 'ephemeral rate-limit windows',
  },
  {
    collection: 'mediaTombstones',
    field: 'expiresAt',
    // AGL-1467 — each holds a deleted media document verbatim. Bounded to the
    // bucket's 7-day soft-delete window: past it a tombstone can only produce a
    // failed restore while still being a copy of customer data.
    why: 'DAM undo records, bounded to the 7-day soft-delete window',
  },
  {
    collection: 'cspViolationDaily',
    field: 'expiresAt',
    // AGL-1799 — one doc per (day × app × directive × disposition × origin).
    why: 'durable CSP-violation counters, 60-day retention',
  },
  {
    collection: 'analytics',
    field: 'expiresAt',
    // AGL-1844 — per-day pageview/serve/redirect counters on hosts and orgs.
    why: 'per-day analytics counters, 400 days',
  },
  {
    collection: 'screenAnalytics',
    field: 'expiresAt',
    // AGL-1844 — the same counters per screen, same policy.
    why: 'per-screen analytics counters, 400 days',
  },

  // ── Declared after the list left the script ────────────────────────────────
  // Each of these is declared in the index file, stamped by its writer and
  // recorded in FIRESTORE_MANUAL_CONFIG.md. A policy belongs in this list from
  // the day it is declared, not the day it goes live: the list is what the
  // platform's retention policy IS, and `set-firestore-ttl.mjs` enables any
  // that a project lacks while skipping those already ACTIVE. Whether each is
  // live on aglyn-main is recorded in the doc, not here. Nothing here applies
  // anything on import — only `set-firestore-ttl.mjs` does, and only when run.
  {
    collection: 'assistExchanges',
    field: 'expiresAt',
    // AGL-1972 — the verbatim question/answer/uid half of an Assist exchange.
    why: 'verbatim Assist exchanges, 180 days',
  },
  {
    collection: 'aiJobs',
    field: 'expiresAt',
    // AGL-2904 — an AI generation job holds the customer's brief verbatim, the
    // step ledger and the creating uid. `createAiJob` stamps the same 180-day
    // clock as an Assist exchange.
    why: 'AI generation jobs (verbatim brief), 180 days',
  },
  {
    collection: 'months',
    field: 'expiresAt',
    // AGL-2928 — a person's monthly AI usage rollup under
    // `orgs/{orgId}/aiUsageByUser/{uid}/months/{YYYY-MM}`. Kept thirteen months
    // past the month it describes (`AI_USAGE_BY_USER_RETENTION_MONTHS`).
    why: 'per-user monthly AI usage, 13 months',
  },
  {
    collection: 'churnSurveyDetails',
    field: 'expiresAt',
    // AGL-1978 — churn survey free text, split out so it can expire without
    // taking the closed-set `reason` (the funnel breakdown) with it.
    why: 'churn survey free text, 365 days',
  },
  {
    collection: 'apiIdempotency',
    field: 'expiresAt',
    // AGL-618/AGL-1978 — replay keys that also store the original response
    // body, i.e. a second copy of every record created through the REST API.
    why: 'REST/POS/marketplace replay keys, 30 days',
  },
  {
    collection: 'authHandoffs',
    field: 'expiresAt',
    // AGL-1902 — a cross-domain session handoff record. It holds the SHA-256
    // of two secrets that together buy a session plus the uid it would mint
    // for, so an unexpired leftover is the one document worth stealing.
    // Expiry is enforced in code as well; this bounds the row itself.
    why: 'cross-domain session handoff records',
  },
])
