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

import type {
  AglynOrgBilling,
  ConsolePluginOrgMount,
  ConsolePluginPageProps,
} from '@aglyn/aglyn'
import { GridItems } from '@aglyn/shared-ui-jsx'
import { HubSections } from '@aglyn/shared-ui-next'
import { useMemo, type ReactNode } from 'react'
import AnnouncementBarCard from './announcement-bar-card.component'
import CampaignDetailCard from './campaign-detail-card'
import CampaignsCard from './campaigns-card'
import CampaignConversionsCard from './campaign-conversions-card'
import HostExperimentsCard from './host-experiments-card.component'
import HostMarketingSummaryCard from './host-marketing-summary-card.component'
import HostOverlaysCard from './host-overlays-card.component'
import PopupCard from './popup-card.component'
import EmailComposeCard from './email-compose-card'
import EmailDetail from './email-detail'
import EmailsListCard from './emails-list-card'
import type { MarketingConsoleSectionId } from './marketing-console-sections'
import {
  MarketingOrgMountProvider,
  type MarketingOrgMount,
} from './marketing-org-mount'

/**
 * The body of one marketing section, built only when that section is the one
 * being read (AGL-2501).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT every section every render, and each card opens its
 * Firestore listens on mount — which is the entire cost this page exists to
 * stop paying. Only the returned branch is ever built.
 */
function sectionBody(
  section: MarketingConsoleSectionId,
  hostId: string,
  org: Partial<AglynOrgBilling> | undefined,
  /**
   * The section's OWN segments — `segments[1]` onward, already sliced by the
   * caller. A section that owns deeper routes reads them here; one that does
   * not simply ignores them.
   */
  detail: readonly string[],
  basePath: string,
): ReactNode {
  switch (section) {
    case 'overview':
      return <HostMarketingSummaryCard hostId={hostId} />
    case 'campaigns':
      /*
       * `/marketing/campaigns/{id}` is one campaign, and it is a ROUTE rather
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
    case 'conversions':
      /*
       * `/marketing/conversions/{campaignId}` narrows the list to one
       * campaign's credited conversions — the drill-down from that campaign's
       * report. A segment rather than a query string, so the section owns its
       * own subtree exactly as `campaigns` does and the URL is linkable.
       */
      return (
        <CampaignConversionsCard
          hostId={hostId}
          basePath={basePath}
          campaignId={detail[0]}
        />
      )
    case 'overlays':
      return (
        <GridItems
          masonry
          spacing={3}
          items={[
            {
              size: { xs: 12 },
              children: <HostOverlaysCard hostId={hostId} org={org} />,
            },
            {
              size: { xs: 12, md: 6 },
              children: <AnnouncementBarCard hostId={hostId} org={org} />,
            },
            {
              size: { xs: 12, md: 6 },
              children: <PopupCard hostId={hostId} org={org} />,
            },
          ]}
        />
      )
    case 'experiments':
      return <HostExperimentsCard hostId={hostId} org={org} />
    default:
      return null
  }
}

/**
 * The body of one ORGANIZATION-level section: the campaigns and the emails,
 * over every site.
 *
 * The same cards as the site hub, handed no site. Each reads the org's
 * collections unfiltered and takes what stays a site fact — the sender, the
 * designs, the conversions — from the site a send is sent as, or asks which
 * site when it is about to create one.
 */
function orgSectionBody(
  section: MarketingConsoleSectionId,
  detail: readonly string[],
  basePath: string,
): ReactNode {
  switch (section) {
    case 'campaigns':
      return detail[0] ? (
        <CampaignDetailCard
          hostId={null}
          campaignId={detail[0]}
          basePath={basePath}
        />
      ) : (
        <CampaignsCard hostId={null} basePath={basePath} />
      )
    case 'emails':
      /*
       * `…/emails` lists them, `…/emails/{id}` reports on one and
       * `…/emails/{id}/edit` writes it — the Emails console's Messages
       * grammar, under the org hub because there is no site to host it.
       */
      return detail[0] ? (
        detail[1] === 'edit' ? (
          <EmailComposeCard
            hostId={null}
            emailId={detail[0]}
            basePath={basePath}
          />
        ) : (
          <EmailDetail hostId={null} emailId={detail[0]} basePath={basePath} />
        )
      ) : (
        <EmailsListCard hostId={null} basePath={basePath} />
      )
    default:
      return null
  }
}

/** The shell's org mount, as the Marketing cards read it through context. */
function marketingOrgMount(
  orgMount: ConsolePluginOrgMount | undefined,
  basePath: string | undefined,
): MarketingOrgMount | null {
  if (!orgMount || !basePath) return null
  return {
    orgId: orgMount.orgId,
    orgSlug: orgMount.orgSlug,
    hosts: orgMount.hosts,
    hostsReady: orgMount.hostsReady,
    hostsPath: orgMount.hostsPath,
    basePath,
  }
}

/**
 * Marketing page (AGL-251 → AGL-395): the at-a-glance rollup, the email
 * campaigns, the overlay managers (multi-overlay + announcement bar + popup),
 * and A/B testing — owned by the marketing plugin and rendered by the shell's
 * generic plugin route. Each gated card runs its own entitlement check
 * (overlays vs A/B are distinct plan flags) off the shell's resolved `org`;
 * the popup image picker uses the shell's media browser via `useMediaPicker`.
 *
 * A CAMPAIGN belongs here and not on the Emails console because it is a
 * container with a window of dates, a set of lists, a topic and revenue
 * attribution — a marketing object that reaches people by email. Its server
 * half has always lived in this plugin. The individual MESSAGES, the
 * templates they are built from and the identities they leave on stay on
 * Emails, and each email's page links here for its campaign.
 *
 * Sections are ROUTES (AGL-2501). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `marketing-console-read-cost.spec.tsx` was
 * written BEFORE the conversion precisely to hold that line, and reports the
 * same counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag.
 */
export function MarketingConsolePage(props: ConsolePluginPageProps) {
  const { hostId, orgMount, org, section, sections, basePath, segments } = props
  /*
   * Mounted with no site: the organization's hub. Memoised because every card
   * below reads it through context, and a fresh object each render would
   * re-render all of them for nothing.
   */
  const mount = useMemo(
    () => (hostId == null ? marketingOrgMount(orgMount, basePath) : null),
    [hostId, orgMount, basePath],
  )

  /*
   * Nothing until the URL names a section. The shell redirects a bare hub URL
   * to the landing section and holds a spinner while it does, so this state is
   * transient — and rendering a default section here instead would pay for its
   * listens on a URL that is already being replaced.
   */
  if (!section || !sections?.length || !basePath) return null
  // `segments[0]` IS the section — the shell resolved it into `section`
  // already — so what a section owns is everything after it.
  const detail = (segments ?? []).slice(1)

  if (hostId == null) {
    // No site and no org to stand in for it: nothing this page can scope.
    if (!mount) return null
    return (
      <MarketingOrgMountProvider value={mount}>
        <HubSections sections={sections}>
          {orgSectionBody(
            section as MarketingConsoleSectionId,
            detail,
            basePath,
          )}
        </HubSections>
      </MarketingOrgMountProvider>
    )
  }

  return (
    <HubSections sections={sections}>
      {sectionBody(
        section as MarketingConsoleSectionId,
        hostId,
        org,
        detail,
        basePath,
      )}
    </HubSections>
  )
}
MarketingConsolePage.displayName = 'MarketingConsolePage'

export default MarketingConsolePage
