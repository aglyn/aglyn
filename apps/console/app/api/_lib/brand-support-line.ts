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

import type { ResolvedBrandingProfile } from '@aglyn/aglyn'

/**
 * The "Need help?" footer of a built-in transactional email — **or nothing**
 * (AGL-2428).
 *
 * A white-label organization that left its Support URL blank resolves
 * `supportUrl` to null, and this returns the empty string rather than a line
 * pointing at Aglyn. The recipient of that mail is the organization's own
 * customer: our desk cannot help them, and the link would name their vendor
 * to somebody who was never told one exists.
 *
 * It returns the SEPARATOR too, not just the sentence. A caller that
 * concatenated `\n\n` itself would leave two blank lines at the end of the
 * message for exactly the orgs this exists for — the "gap where something
 * should be" that `emailLogoUrl` already avoids one field over.
 *
 * Every org WITHOUT the concealment entitlement resolves to the platform
 * profile, whose support URL is real, so those emails are unchanged.
 */
export function brandSupportLine(
  branding: Pick<ResolvedBrandingProfile, 'supportUrl'>,
): string {
  const url = typeof branding.supportUrl === 'string' ? branding.supportUrl.trim() : ''
  return url ? `\n\nNeed help? ${url}` : ''
}
