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

export type MarketingConsoleSectionId =
  | 'overview'
  | 'campaigns'
  | 'conversions'
  | 'overlays'
  | 'experiments'

/**
 * The marketing console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back.
 *
 * Ids are the `?tab=` ids this page already deep-linked by, kept deliberately
 * so a bookmark that named a tab names the same section as a route. `experiments`
 * therefore keeps its id while its LABEL reads "A/B testing".
 *
 * No `navTabId` on any of them: they inherit the Marketing nav item's gate.
 * The per-card ENTITLEMENT checks are unchanged and still live in the cards —
 * overlays and A/B are distinct plan flags, and a plan is not a release flag.
 */
export const MARKETING_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'overview', label: 'Overview' },
  /*
   * A campaign is a CONTAINER with a window of dates, a set of lists, a topic
   * and revenue attribution — a marketing object that reaches people by
   * email, rather than an email object. It sits beside A/B testing because
   * that is what campaign results are attributed against, and beside the
   * overlays because both are ways of putting the same offer in front of the
   * same audience.
   *
   * The individual MESSAGES stay on the Emails console, along with the
   * templates they are built from and the sending identities they leave on.
   * Each email's page links here for the campaign it belongs to.
   */
  { id: 'campaigns', label: 'Campaigns' },
  /*
   * What the campaigns CAUSED, from the conversions' end. A campaign's own
   * report answers this for that campaign; a section is what answers it for
   * the site, and it is the only place two things can be said that a campaign
   * report structurally cannot: the conversions credited to a tagged web link
   * rather than to a campaign document, and the ones credited to nothing at
   * all. A surface listing only the credited ones renders "we credited nine
   * of these" as "nine of these happened".
   */
  { id: 'conversions', label: 'Conversions' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'experiments', label: 'A/B testing' },
]

/*
 * Rail ORDER decides where `/marketing` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-2501). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */

/**
 * The ORGANIZATION-level Marketing hub's sections, at `/[orgSlug]/marketing`
 * — the site rail's, in the site rail's order, so the two levels of the hub
 * read as one surface and a bare `/[orgSlug]/marketing` lands on Overview.
 *
 * Each section reads what it can at the organization's level and what it
 * must per site. Campaigns and their sends belong to the organization, so
 * the campaigns list and the Overview's email figures are one org
 * collection each. Overlays and A/B tests are drawn on one site's pages, so
 * those two list site by site, a page of sites at a time, and send the
 * reader to the site to edit; conversions are one site's visitors, so that
 * section reads the site the reader picks.
 *
 * Overlays and A/B testing carry their plan flags HERE, unlike the site
 * rail, whose cards run the same checks themselves: at the org level a
 * section is a fan-out over sites, and gating the section in the shell is
 * what keeps an organization without the plan from mounting one read per
 * site to be told it cannot have them.
 *
 * A literal rather than a mapping of the site list: the console's title
 * table and its spec read the ids and labels from this source.
 *
 * No `emails` section: an email is one send of a campaign, and the list of
 * them is the organization's Emails page, as a site's is its own.
 */
export const MARKETING_ORG_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'conversions', label: 'Conversions' },
  { id: 'overlays', label: 'Overlays', featureFlag: 'marketingOverlays' },
  { id: 'experiments', label: 'A/B testing', featureFlag: 'abTesting' },
]
