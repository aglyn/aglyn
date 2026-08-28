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

export type EmailsConsoleSectionId =
  'campaigns' | 'designs' | 'audiences' | 'suppressions'

/**
 * The emails console's sections, in rail order (AGL-693).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back.
 *
 * Ids appear in links people keep — treat them as persisted, and rename a
 * LABEL rather than an id. These four are the `?tab=` ids this page already
 * deep-linked by, kept deliberately so a bookmark that named a tab names the
 * same section as a route.
 *
 * No `navTabId` on any of them: every section ships with the surface, so they
 * inherit the Emails nav item's gate.
 */
export const EMAILS_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'designs', label: 'Designs' },
  { id: 'audiences', label: 'Audiences' },
  // Beside the audiences rather than inside them (AGL-2410): a suppression is
  // not a list you build, it is the reason a list you built did not all get
  // mailed.
  { id: 'suppressions', label: 'Suppressions' },
]

/*
 * Rail ORDER decides where `/emails` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-693). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
