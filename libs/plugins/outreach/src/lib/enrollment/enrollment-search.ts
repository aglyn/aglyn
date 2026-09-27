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

import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { emailSearchTokens } from '@aglyn/tenant-data-admin/server/email-suppression'
import type { OutreachEnrollment } from '../model/outreach.types'

/**
 * What a sequence's enrollments table searches an enrollment by (AGL-3321):
 * every prefix of each word of the person's name, and of their address, its
 * domain and each piece of either — the same address derivation the
 * platform's suppression search uses — so "casey", "morgan" and "example"
 * all find Casey Morgan at casey.morgan@example.com.
 *
 * Both halves are captured once, at enrollment, and never rewritten (an
 * erasure deletes the enrollment rather than editing it), so the enroll
 * route stamps this on the document it creates and nothing else has to.
 * `tools/scripts/backfill-outreach-list-search.mjs` restates it for the
 * enrollments made before it; both are held to
 * `tools/scripts/lib/outreach-search-tokens.fixtures.json`.
 */
export function outreachEnrollmentSearchTokens(
  enrollment: Pick<OutreachEnrollment, 'contactName' | 'email'>,
): string[] {
  return [
    ...new Set([
      ...nameSearchTokens(enrollment.contactName),
      ...emailSearchTokens(enrollment.email),
    ]),
  ]
}
