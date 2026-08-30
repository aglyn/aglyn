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
'use client'

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import type { ReactNode } from 'react'
import CampaignDetailCard from './campaign-detail-card'
import CampaignsCard from './campaigns-card'
import EmailDetail from './email-detail'
import EmailScreensCard from './email-screens-card'
import EmailTemplateDetail from './email-template-detail'
import EmailTopicDetail from './email-topic-detail'
import EmailTopicsCard from './email-topics-card'
import EmailsListCard from './emails-list-card'
import ListDetailCard from './list-detail-card'
import ListEditCard from './list-edit-card'
import ListsCard from './lists-card'
import SuppressionsCard from './suppressions-card'
import type { EmailsConsoleSectionId } from './emails-console-sections'

/**
 * The body of one emails section, built only when that section is the one
 * being read (AGL-2501).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT every section on every render, and each card opens its
 * Firestore listens on mount — which is the entire cost this page exists to
 * stop paying. Only the returned branch is ever built.
 */
function sectionBody(
  section: EmailsConsoleSectionId,
  hostId: string,
  /**
   * The section's OWN segments — `segments[1]` onward, already sliced by the
   * caller. A section that owns deeper routes reads them here; one that does
   * not simply ignores them.
   */
  detail: readonly string[],
  basePath: string,
): ReactNode {
  switch (section) {
    case 'campaigns':
      /*
       * `/emails/campaigns/{id}` is one campaign, and it is a ROUTE rather
       * than an expanded row for two reasons: it is linkable, which is what a
       * merchant wants to paste into a message about last week's send; and
       * the composer plus the campaign list are the surface's expensive
       * listens, so a reader who came for one campaign's numbers must not pay
       * for them.
       *
       * The id may name a CAMPAIGN or, for every URL minted before campaigns
       * grouped their emails, a single SEND. `CampaignDetailCard` answers that
       * by reading, and falls through to the send's own report — so no pasted
       * link stops resolving.
       *
       * No registry entry is needed — the shell hands a section every segment
       * beneath it, so a section owns its own subtree. The gate is the
       * section's, which is the same gate the composer is behind.
       */
      return detail[0] ? (
        <CampaignDetailCard
          hostId={hostId}
          campaignId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <CampaignsCard hostId={hostId} basePath={basePath} />
      )
    case 'emails':
      /*
       * `/emails/emails/{emailId}` is ONE MESSAGE — the thing that was or
       * will be sent, as against the campaign that groups messages and the
       * template they are built from. A route for the same reasons the
       * campaign report is one: it is linkable, and its preview, link table
       * and recipient list are reads the list above it must not pay for.
       */
      return detail[0] ? (
        <EmailDetail
          hostId={hostId}
          emailId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <EmailsListCard hostId={hostId} basePath={basePath} />
      )
    case 'templates':
      /*
       * `/emails/templates/{screenId}` is one TEMPLATE's page. The section id
       * stays `designs` while the label says Templates — an id appears in
       * links people keep, so the vocabulary moves and the URL does not
       * break.
       *
       * A route for the same reasons the campaign report is one: it is
       * linkable, and the listing above it is a cheaper surface a reader who
       * came for one template should not have to mount. The preview, the
       * aggregate figures and the recipients table all hang off this branch,
       * so none of them is constructed while the list is what is being read.
       */
      return detail[0] ? (
        <EmailTemplateDetail
          hostId={hostId}
          screenId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <EmailScreensCard hostId={hostId} basePath={basePath} />
      )
    case 'audiences':
      /*
       * A list is a resource with its own pages, on the same terms the
       * campaign report is: `/emails/audiences/{listId}` is one audience, and
       * `…/edit` is its settings.
       *
       * The membership used to unfold inside the audiences table. That made a
       * list unlinkable, put the back button one press from leaving the whole
       * surface, and asked the reader of a list of lists to hold the table
       * that lists them AND the table of one list's subscribers on the same
       * screen. The subscribers are also the expensive read here — one PII
       * document per person — so putting them behind a route is what stops
       * them being paid for by somebody who came to see which audiences exist.
       *
       * Ternaries rather than a lookup: only the branch taken is CONSTRUCTED,
       * which is the cost this whole function is shaped around.
       */
      return detail[0] ? (
        detail[1] === 'edit' ? (
          <ListEditCard
            hostId={hostId}
            listId={detail[0]}
            basePath={basePath}
          />
        ) : (
          <ListDetailCard
            hostId={hostId}
            listId={detail[0]}
            basePath={basePath}
          />
        )
      ) : (
        <ListsCard hostId={hostId} basePath={basePath} />
      )
    case 'topics':
      // Create is a drawer on the list; EDIT is the topic's own route, which
      // is the section owning its own subtree exactly as `campaigns` does.
      return detail[0] ? (
        <EmailTopicDetail
          hostId={hostId}
          topicId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <EmailTopicsCard hostId={hostId} />
      )
    case 'suppressions':
      return <SuppressionsCard hostId={hostId} />
    default:
      return null
  }
}

/**
 * Emails page (AGL-395): the console surface owned by the email plugin,
 * rendered by the shell's generic plugin route.
 *
 * Five sections, and three of them are three different things a merchant
 * calls "an email": a CAMPAIGN groups sends, an EMAIL is one message that was
 * or will be sent, and a TEMPLATE is the reusable besigner document a message
 * is built from. Keeping them apart is what lets each carry its own report —
 * a message's own numbers, and a template's summed across every message sent
 * from it. Audience lists and the suppression list complete the surface.
 *
 * Sections are ROUTES (AGL-2501). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `emails-console-read-cost.spec.tsx` was written
 * BEFORE the conversion precisely to hold that line, and reports the same
 * counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag
 * somebody has to remember on the next surface.
 */
export function EmailsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, section, sections, basePath, segments } = props

  /*
   * Nothing, deliberately, while the redirect is in flight. Rendering the
   * default section here would issue its listens on a URL about to be
   * replaced — on every arrival at `/emails`, which is every nav-tab click.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(
        section as EmailsConsoleSectionId,
        hostId,
        // `segments[0]` IS the section — the shell resolved it into `section`
        // already — so what a section owns is everything after it.
        (segments ?? []).slice(1),
        basePath,
      )}
    </HubSections>
  )
}
EmailsConsolePage.displayName = 'EmailsConsolePage'

export default EmailsConsolePage
