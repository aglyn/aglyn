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

export type InboxConsoleSectionId = 'submissions' | 'contacts' | 'campaigns'

/**
 * The inbox console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back. A second copy is how a section comes
 * to be routable under one id and drawn under another.
 *
 * Ids are the `?tab=` ids this page already deep-linked by, kept deliberately
 * so a bookmark that named a tab names the same section as a route. `contacts`
 * therefore keeps its id while its LABEL reads "Members & leads".
 *
 * ORDERS ARE NOT HERE, and the omission is the decision. A sale is not
 * something that arrived in an inbox, and commerce owns the surface that
 * lists them: `commerce-console-sections.ts` declares an `orders` section
 * rendering the same card. Adding one here would give one record two
 * addresses.
 *
 * No `navTabId` on any of them: every section ships with the surface, so they
 * inherit the Inbox nav item's gate.
 */
export const INBOX_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'submissions', label: 'Submissions' },
  /*
   * The people a site collected, members and leads in one list. Its label
   * names both because the table is one list of two collections — a member
   * who was a lead first appears once, and a rail reading "Contacts" beside
   * the Contacts nav item would name a different surface's subject.
   */
  { id: 'contacts', label: 'Members & leads' },
  /*
   * Borrowed from the marketing plugin, which owns the campaign. It is listed
   * here because a campaign is the outbound half of the same conversation the
   * submissions are the inbound half of, and a merchant reading one reaches
   * for the other.
   */
  { id: 'campaigns', label: 'Campaigns' },
]

/*
 * Rail ORDER decides where `/inbox` lands: the shell redirects a bare hub URL
 * to the first section in this list the reader may open (AGL-2501). There is
 * deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
