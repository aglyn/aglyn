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
  | 'emails'
  | 'templates'
  | 'audiences'
  | 'topics'
  | 'sending'
  | 'suppressions'

/**
 * The emails console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back.
 *
 * Ids appear in links people keep — treat them as persisted, and prefer
 * renaming a LABEL over an id. `audiences` and `suppressions` are also the
 * `?tab=` ids this page deep-linked by before its sections became routes, so
 * a bookmark that named one of those tabs still names the same section.
 *
 * No `navTabId` on any of them: every section ships with the surface, so they
 * inherit the Emails nav item's gate.
 */
export const EMAILS_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  /*
   * The individual messages: one row per email that was or will be sent, each
   * with its own report.
   *
   * A message is what this surface is about. The CAMPAIGN that groups
   * messages is a marketing object — a window of dates, a set of lists, a
   * topic and revenue attribution, which happens to reach people by email —
   * so it is a section of the Marketing console and an email's page links out
   * to it.
   */
  { id: 'emails', label: 'Emails' },
  /*
   * The reusable besigner documents a message is built from.
   *
   * Id and label say the same word on purpose: a template is the vocabulary
   * everywhere else in this surface — an email names the template it renders,
   * and the marketplace publishes them — so a URL saying anything else would
   * be the one place the reader has to translate.
   */
  { id: 'templates', label: 'Templates' },
  { id: 'audiences', label: 'Audiences' },
  // Between the audiences and the suppressions, which is where a topic sits
  // conceptually: an audience is who you may reach, a suppression is who you
  // may not, and a topic is the stream a recipient can leave without becoming
  // either.
  { id: 'topics', label: 'Topics' },
  /*
   * WHO THE MAIL COMES FROM, as against who it goes to.
   *
   * After the three audience sections and before Suppressions, which is where
   * the question sits: everything above decides who is reached, and this one
   * decides what they see in the `From:` line. It is also the section a
   * merchant is sent to from the composer when a send is refused for an
   * unverified identity, so it has to be a route of its own.
   */
  { id: 'sending', label: 'Sending' },
  // Beside the audiences rather than inside them (AGL-2410): a suppression is
  // not a list you build, it is the reason a list you built did not all get
  // mailed.
  { id: 'suppressions', label: 'Suppressions' },
]

/*
 * Rail ORDER decides where `/emails` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-2501). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */
