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

// The one place that knows how an Aglyn-owned script identifies itself to our
// own firewall (AGL-1611).
//
// WHY THIS IS A SHARED HELPER AND NOT THREE TERNARIES. Vercel Bot Protection
// challenges automated clients, so every live fetch from CI came back 429
// (Vercel Security Checkpoint). A Bypass rule keyed on `x-aglyn-probe` fixes
// it, and the header was duly added to `probe-uptime.mjs` and
// `legal-doc-diff.mjs` — but NOT to `check-legal-index-dates.mjs`, which does
// its own fetch of `/legal`. The uptime probe went green, the drift diff went
// green, and the index check kept failing 429 in the same workflow run.
//
// That is the failure mode worth designing against: the header is invisible
// infrastructure, so a new live-fetching script does not look like it is
// missing anything. Importing a named helper does not fix that by itself, but
// it makes the omission answerable by `grep -L probe-headers` over the scripts
// that fetch our own hosts, and it gives the reasoning one home instead of
// three paraphrases that drift apart.
//
// FAILURE DIRECTION. When `AGLYN_PROBE_TOKEN` is absent the header is simply
// not sent — a local run, a fork, or a contributor's checkout behaves exactly
// as it did before the bypass existed. It degrades to "challenged like any
// other bot", never to a crash, because a checker that throws when a secret is
// missing is a checker nobody can run.
//
// SCOPE. This bypasses OUR OWN Bot Protection challenge on OUR OWN hosts. It
// is not a general-purpose header: do not send it to a third party, where it
// would leak a shared secret to someone with no reason to hold it.

/**
 * Merge the firewall-bypass header into a script's own request headers.
 *
 * @param base - headers the caller already wants to send (user-agent, accept,
 *   cache-control). Returned as-is when no token is configured.
 * @returns a new headers object; the caller's keys always win, so this can
 *   never quietly override a `user-agent` a script chose deliberately.
 */
export function withProbeHeaders(base = {}) {
  const token = process.env['AGLYN_PROBE_TOKEN']
  if (!token) return { ...base }
  return { 'x-aglyn-probe': token, ...base }
}

/** True when a bypass token is configured. For diagnostics, never for control flow. */
export function hasProbeToken() {
  return Boolean(process.env['AGLYN_PROBE_TOKEN'])
}
