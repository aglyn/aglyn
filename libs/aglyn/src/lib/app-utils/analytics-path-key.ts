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
 * The map key a request path is counted under inside a day-counter document
 * (`hosts/{hostId}/analytics/{YYYY-MM-DD}`, field `paths`).
 *
 * ## Why this is shared rather than inlined at the writer
 *
 * It began as a private helper in the tenant's `/api/analytics/collect`
 * route, which was fine while the only reader listed the whole map — the host
 * traffic card renders `Object.entries(paths)` and never has to BUILD a key.
 *
 * The content entry's traffic card does (AGL-2498): it holds one entry's
 * public path and looks that single key up. A second, hand-copied
 * `.replace(/[.$#[\]]/g, '_')` is exactly the kind of twin that drifts by one
 * character and then reports a real page as zero views — and a swallowed
 * lookup renders as a MEASURED zero, which is indistinguishable from "nobody
 * read it". So the rule lives in one place and both sides call it.
 *
 * ## What it does, and why
 *
 * Firestore map keys cannot be parsed as field paths on read when they carry
 * `.`, `$`, `#`, `[` or `]`, so those are folded to `_`. The value is capped
 * at 200 characters because a path is attacker-supplied and a map key is
 * unbounded otherwise. An empty path counts as `/` — the home page, which is
 * what an empty path means to a router.
 *
 * ⚠️ The substitution is LOSSY and deliberately so: `/a.b` and `/a_b` share a
 * key. That was already true of every count ever written, so it cannot be
 * fixed here without orphaning the history; a reader must not "improve" it.
 */
export const analyticsPathKey = (path: string): string =>
  (path || '/').slice(0, 200).replace(/[.$#[\]]/g, '_')
