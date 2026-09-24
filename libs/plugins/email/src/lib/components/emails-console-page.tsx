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

import {
  consentGroupForHost,
  type ConsentGroup,
  type ConsolePluginOrgMount,
  type ConsolePluginPageProps,
} from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { HubSections } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import { useMemo, type ReactNode } from 'react'
import { useConsentGroupAccess } from './consent-group-access'
import ConsentGroupConfirmationCard from './consent-group-confirmation-card'
import ConsentGroupsCard from './consent-groups-card'
import EmailScreensCard from './email-screens-card'
import EmailTemplateDetail from './email-template-detail'
import EmailTopicDetail from './email-topic-detail'
import EmailTopicsCard from './email-topics-card'
import ListDetailCard from './list-detail-card'
import ListEditCard from './list-edit-card'
import ListsCard from './lists-card'
import OrgEmailTemplatesCard from './org-email-templates-card'
import OrgSendingCard from './org-sending-card'
import OrgSendingDomainDetail from './org-sending-domain-detail'
import OrgSiteSuppressions from './org-site-suppressions'
import OrgSuppressionsCard from './org-suppressions-card'
import SendingDomainDetail from './sending-domain-detail'
import SendingDomainsCard from './sending-domains-card'
import SiteConsentGroupCard from './site-consent-group-card'
import SuppressionsCard from './suppressions-card'
import type { EmailsConsoleSectionId } from './emails-console-sections'
import { EmailOrgMountProvider, useEmailOrgMount } from './email-org-mount'
import { EMAIL_MESSAGES_ZONE, type EmailMessagesZoneProps } from './email-zones'

/**
 * The Messages section: a zone, drawn by whichever plugin owns campaigns.
 *
 * Its own component because a zone's renderer comes from a hook and
 * `sectionBody` is a plain function — and so that, like every other branch
 * there, it is constructed only while Messages is the section being read.
 */
function EmailMessagesSection(props: EmailMessagesZoneProps) {
  const Zone = useConsoleWidgetSlot()
  return Zone ? <Zone slot={EMAIL_MESSAGES_ZONE.id} {...props} /> : null
}

/**
 * The organization's Consent groups section: the editor, and under it the
 * switch over how a group's sites treat each other's confirmations.
 *
 * Both ask whether the reader may change consent groups, and the two routes
 * behind them ask the same two permissions, so the section reads the
 * reader's membership once and hands the answer to both.
 */
function OrgConsentGroupsSection(props: { org?: Record<string, unknown> }) {
  const orgId = useEmailOrgMount()?.orgId
  const access = useConsentGroupAccess(orgId || undefined)
  return (
    <Stack spacing={3}>
      <ConsentGroupsCard org={props.org} access={access} />
      <ConsentGroupConfirmationCard org={props.org} access={access} />
    </Stack>
  )
}

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
  /**
   * The controller the surface is being viewed as, resolved once by the page.
   *
   * Only the audience detail needs it today — it is what its membership table
   * reads consent FOR — but it is resolved at the page because the answer is a
   * property of the org and this is the one place holding the org document.
   */
  consentGroup: ConsentGroup,
  /**
   * The org document, from which the Consent groups section reads the org's
   * slug and any change in flight.
   */
  org: Record<string, unknown> | undefined,
): ReactNode {
  switch (section) {
    case 'messages':
      /*
       * `/emails/messages/{emailId}` is ONE MESSAGE — the thing that was or
       * will be sent, as against the campaign that groups messages and the
       * template they are built from. A ROUTE rather than an expanded row: it
       * is linkable, which is what a merchant wants to paste into a message
       * about last week's send, and its preview, link table and recipient
       * list are reads the list above it must not pay for.
       *
       * The page links OUT to the campaign this message belongs to, which is
       * a section of the Marketing console.
       */
      /*
       * `…/{emailId}/edit` WRITES the email and `…/{emailId}` reports on
       * it — two jobs with two shapes, and creating stays a drawer on the
       * list. Which of the three is drawn is decided from `detail` by the
       * widget, which builds only the one it is asked for: the composer's
       * listens are not paid for by somebody reading a report.
       */
      return (
        <EmailMessagesSection
          hostId={hostId}
          basePath={basePath}
          detail={detail}
        />
      )
    case 'templates':
      /*
       * `/emails/templates/{screenId}` is one TEMPLATE's page.
       *
       * A route for the same reasons a message's page is one: it is
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
       * A list is a resource with its own pages, on the same terms a message
       * is: `/emails/audiences/{listId}` is one audience, and `…/edit` is its
       * settings.
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
            consentGroup={consentGroup}
            listId={detail[0]}
            basePath={basePath}
          />
        )
      ) : (
        <ListsCard hostId={hostId} basePath={basePath} />
      )
    case 'topics':
      // Create is a drawer on the list; EDIT is the topic's own route, which
      // is the section owning its own subtree exactly as `messages` does.
      return detail[0] ? (
        <EmailTopicDetail
          hostId={hostId}
          topicId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <EmailTopicsCard hostId={hostId} basePath={basePath} />
      )
    case 'sending':
      /*
       * `/emails/sending/{domain}` is one domain's page, and it is a route
       * for the reason every other detail here is: the DNS records, the DMARC
       * read and the verification button are what somebody came for, and a
       * link to them is what they paste to whoever actually edits the zone.
       *
       * The domain is the document id, so it is also the segment. It is
       * decoded because a URL carries it encoded and the record is keyed on
       * the bare name.
       */
      return detail[0] ? (
        <SendingDomainDetail
          hostId={hostId}
          domain={decodeURIComponent(detail[0])}
          basePath={basePath}
        />
      ) : (
        <SendingDomainsCard hostId={hostId} basePath={basePath} />
      )
    case 'consent-groups':
      // Which sender this site is. Declared for the organization, so here it
      // is said and linked, never changed.
      return (
        <SiteConsentGroupCard
          hostId={hostId}
          consentGroup={consentGroup}
          org={org}
        />
      )
    case 'suppressions':
      return <SuppressionsCard hostId={hostId} />
    default:
      return null
  }
}

/**
 * The body of one ORGANIZATION-level section, at `/[orgSlug]/emails`.
 *
 * The same seven sections as a site's, each answering over the organization.
 * Three of them are already the org's — an audience and a topic are shared by
 * every site, and a consent group is declared for several — so their cards
 * render with no site. The other four are site facts: a message is sent as
 * one site, a template is one site's screen, a sending identity and a
 * suppression list are one site's. Those sections read each site in turn, a
 * page of sites at a time, and link a row into the site that holds it.
 *
 * Built only when that section is the one being read, for the reason
 * {@link sectionBody} is: every card opens its reads on mount.
 */
function orgSectionBody(
  section: EmailsConsoleSectionId,
  detail: readonly string[],
  basePath: string,
  orgMount: ConsolePluginOrgMount,
  /** The org document, from which an audience's consent group is resolved. */
  org: Record<string, unknown> | undefined,
): ReactNode {
  switch (section) {
    case 'messages':
      // Every site's messages, drawn by the plugin that sends; it is handed
      // the org mount so it can say which site each was sent as.
      return (
        <EmailMessagesSection
          hostId={null}
          orgMount={orgMount}
          basePath={basePath}
          detail={detail}
        />
      )
    case 'templates':
      /*
       * One table over every site's templates. A template is a screen on one
       * site, so its own page stays that site's: each row links there, and
       * nothing beneath this section is an org route.
       */
      return <OrgEmailTemplatesCard />
    case 'audiences':
      return detail[0] ? (
        detail[1] === 'edit' ? (
          <ListEditCard hostId={null} listId={detail[0]} basePath={basePath} />
        ) : (
          <ListDetailCard
            hostId={null}
            org={org}
            listId={detail[0]}
            basePath={basePath}
          />
        )
      ) : (
        <ListsCard hostId={null} basePath={basePath} />
      )
    case 'topics':
      return detail[0] ? (
        <EmailTopicDetail
          hostId={null}
          topicId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <EmailTopicsCard hostId={null} basePath={basePath} />
      )
    case 'sending':
      /*
       * A domain is proved by the organization, so its page is an org route
       * here as it is under a site. What each SITE sends as is the other half,
       * and the section's own page lists it per site.
       */
      return detail[0] ? (
        <OrgSendingDomainDetail
          domain={decodeURIComponent(detail[0])}
          basePath={basePath}
        />
      ) : (
        <OrgSendingCard basePath={basePath} />
      )
    case 'consent-groups':
      /*
       * The declaration itself, and under it the organization's one switch
       * over how a declared group treats a confirmation one of its sites is
       * waiting on — the switch belongs with the groups it governs rather
       * than with the topics that each set their own confirmation.
       */
      return <OrgConsentGroupsSection org={org} />
    case 'suppressions':
      /*
       * `…/suppressions` totals every site's list; `…/suppressions/{hostId}`
       * is one site's list itself, the same card a site's own page draws.
       */
      return detail[0] ? (
        <OrgSiteSuppressions hostId={detail[0]} />
      ) : (
        <OrgSuppressionsCard />
      )
    default:
      return null
  }
}

/**
 * Emails page (AGL-395): the console surface owned by the email plugin,
 * rendered by the shell's generic plugin route.
 *
 * Two of its sections are two different things a merchant calls "an email":
 * an EMAIL is one message that was or will be sent, and a TEMPLATE is the
 * reusable besigner document a message is built from. Keeping them apart is
 * what lets each carry its own report — a message's own numbers, and a
 * template's summed across every message sent from it. Audience lists, the
 * topic catalog, the sending identities and the suppression list complete the
 * surface.
 *
 * The CAMPAIGN that groups messages is not here. It is a container with a
 * window of dates, a set of lists, a topic and revenue attribution — a
 * marketing object that reaches people by email — so it is a section of the
 * Marketing console, and a message's page links out to the campaign it
 * belongs to.
 *
 * Sections are ROUTES (AGL-2501). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `emails-console-read-cost.spec.tsx` was written
 * BEFORE the conversion precisely to hold that line, and reports the same
 * counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag
 * somebody has to remember on the next surface.
 *
 * The same page is the ORGANIZATION's Emails page at `/[orgSlug]/emails`.
 * Handed no site, it publishes the org mount to its cards and renders
 * {@link orgSectionBody} instead: the same seven sections, over every site.
 */
export function EmailsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, orgMount, org, section, sections, basePath, segments } =
    props

  /*==========================================
   * THE CONTROLLER THIS SURFACE IS BEING VIEWED AS.
   *
   * The declared group of sites that are one sender, or this site alone. Every
   * consent question asked below is asked FOR a controller and not for a site:
   * a grant is looked up under the asking site, a refusal is honored across
   * the whole group, and a grant held by a site outside it belongs to somebody
   * else. It is the same group `performCampaignSend` resolves, so the audience
   * table and the send agree about the same document by construction.
   *
   * Pure, from the org document the shell already passed, so it costs no read.
   * An absent org resolves to the group of one, which is the narrow answer.
   *
   * Only under a site. The organization's page has no site to resolve a group
   * FOR, and `consentGroupForHost` refuses to invent one — the audience page
   * there resolves it for the site the reader enrolls as, once one is chosen.
   *=========================================*/
  const consentGroup = useMemo(
    () =>
      hostId == null
        ? null
        : consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )

  /*
   * Nothing, deliberately, while the redirect is in flight. Rendering the
   * default section here would issue its listens on a URL about to be
   * replaced — on every arrival at `/emails`, which is every nav-tab click.
   */
  if (!section || !sections?.length || !basePath) return null
  // `segments[0]` IS the section — the shell resolved it into `section`
  // already — so what a section owns is everything after it.
  const detail = (segments ?? []).slice(1)

  if (hostId == null) {
    // No site and no org to stand in for it: nothing this page can scope.
    if (!orgMount) return null
    return (
      <EmailOrgMountProvider mount={orgMount} basePath={basePath}>
        <HubSections sections={sections}>
          {orgSectionBody(
            section as EmailsConsoleSectionId,
            detail,
            basePath,
            orgMount,
            org as Record<string, unknown> | undefined,
          )}
        </HubSections>
      </EmailOrgMountProvider>
    )
  }

  return (
    <HubSections sections={sections}>
      {sectionBody(
        section as EmailsConsoleSectionId,
        hostId,
        detail,
        basePath,
        consentGroup as ConsentGroup,
        org as Record<string, unknown> | undefined,
      )}
    </HubSections>
  )
}
EmailsConsolePage.displayName = 'EmailsConsolePage'

export default EmailsConsolePage
