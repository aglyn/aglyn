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
 * Is a destination a path on the site itself? (AGL-1881.)
 *
 * The question behind a declared `externalDestination`: a value that is not
 * plainly a site path is one that sends traffic off the platform, and takes
 * the approver stamp. Written to answer FALSE for anything that is not plainly
 * a path, including `undefined`, so a create that omits the field is treated
 * as external and takes the stamp rather than skipping it. `strictNullChecks`
 * is off, so the `typeof` test is what keeps a missing value out of
 * `.startsWith`.
 *
 * The redirects plugin's `isExternalRedirectDestination` is the same predicate
 * negated, for the one kind that declares a destination today; the two must
 * agree, and the direction of any disagreement is a rule that does not fire,
 * never one that fires unapproved.
 *
 * Shared by the create route and the site restore (AGL-3533), which stamps
 * the importing admin as the approver of a restored off-site destination: a
 * file's approver is provenance it cannot supply.
 */
export function isSitePath(destination: unknown): boolean {
  if (typeof destination !== 'string') return false
  const value = destination.trim()
  return value.startsWith('/') && !value.startsWith('//')
}
