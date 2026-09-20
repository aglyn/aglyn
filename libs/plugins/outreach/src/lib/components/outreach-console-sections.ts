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

import type { ConsoleNavSection } from '@aglyn/aglyn'

export type OutreachConsoleSectionId = 'sequences' | 'mailboxes' | 'compliance'

/**
 * The Sequences hub's sections, in rail order (AGL-2974).
 *
 * Read twice and never copied, the CRM's rule: `plugin.ts` registers the list
 * on the org nav item so the shell routes and gates each section, and the hub
 * page switches its body on the id the shell resolves back. The console's
 * `PLUGIN_SECTIONS` title table keeps a checked copy for its server layout.
 *
 * Ids are persisted vocabulary — `/[orgSlug]/outreach/sequences` is a link
 * people keep, and the surface slug stays `outreach` for the same reason the
 * plugin id does (AGL-3199). Sequences is first because it is where the work
 * is, and so it is where a bare `/outreach` lands.
 *
 * Every section inherits the nav item's `release_outreach` gate and the
 * extension's `features.outreach` entitlement and `outreach.use` permission;
 * a section that later needs a narrower one declares it, which can only
 * narrow.
 */
export const OUTREACH_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'sequences', label: 'Sequences' },
  { id: 'mailboxes', label: 'Mailboxes' },
  // The footer's sender identity and the allowed countries (AGL-2980).
  { id: 'compliance', label: 'Compliance' },
]
