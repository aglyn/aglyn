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

import { PLATFORM_BRAND_NAME, registerConsoleExtension } from '@aglyn/aglyn'
import { AiCollaboratorPermissionsCell } from './components/ai-collaborator-permissions-column.component'
import {
  AiGenerateSectionControl,
  AiRewriteControl,
} from './components/besigner-ai-controls.component'
import {
  AiAssistProviderOnHost,
  AssistPanelOnHost,
} from './components/ai-permissions-on-host.component'
import AiCreditsCard from './components/ai-credits-card.component'
import {
  AiCollaboratorCreditsCell,
  AiCollaboratorCreditsHeader,
  AiMemberCreditsCell,
  AiMemberCreditsHeader,
} from './components/ai-credits-columns.component'
import { AssistSignalsPage } from './components/assist-signals-page.component'
import BillingAssistOverageCard from './components/billing-assist-overage-card.component'
import { AiTopUsersCard } from './components/billing-ai-top-users.component'
import { AiAllotmentsCard } from './components/billing-ai-allotments.component'
import {
  AiCollaboratorAllotmentCell,
  AiCollaboratorAllotmentHeader,
  AiSiteAllotmentCard,
} from './components/host-ai-allotments.component'
import MemberAiAllotmentCard from './components/member-ai-allotment-card.component'
import MemberAiUsageCard from './components/member-ai-usage-card.component'
import AiThemeProposalCard from './components/ai-theme-proposal-card.component'
import StaffOrgAiCard from './components/staff-org-ai-card.component'
import {
  StaffOrgUsageAiCreditsCell,
  StaffOrgUsageAiOverageCell,
  StaffOrgUsageAiPool,
  StaffOrgUsageAssistCell,
} from './components/staff-org-usage-ai-columns.component'
import {
  StaffOrgsAiSpendCell,
  StaffOrgsAiSpendHeader,
} from './components/staff-orgs-ai-spend-column.component'
import StaffUserAiUsageCard from './components/staff-user-ai-usage-card.component'
import AiSeoAuditCard from './components/ai-seo-audit-card.component'
import AiSiteBatchCard from './components/ai-site-batch-card.component'
import AiSeoFieldsCard from './components/ai-seo-fields-card.component'
import { AI_PLUGIN_ID } from './constants'
import { registerAiDeclarations } from './declarations'

/**
 * The Aglyn AI plugin's console half (AGL-2939): the assistant dock, the
 * besigner copy assistant's provider, the billing, member and staff cards,
 * the member tables' credit columns and the Assist signal staff page — each
 * mounted through a shell-owned zone (AGL-2940) or the staff area's generic
 * route, so no console page imports this plugin.
 *
 * No `featureFlag` on the extension: the plugin's doors are gated one by
 * one — the dock reads the `release_assist` verdict the shell hands it, the
 * generative doors answer 404 behind `release_ai_generative`, the billing
 * cards render only where the plan sells a band — and a flag here would
 * switch off the released doors with the unreleased ones.
 */
export function registerAiConsole(): void {
  registerAiDeclarations()
  registerConsoleExtension({
    pluginId: AI_PLUGIN_ID,
    displayName: 'AI',
    // The besigner copy assistant (AGL-89/419): mounted by the shell around
    // every console page, and opened by this plugin's besigner controls.
    providers: [AiAssistProviderOnHost],
    // The Assist docs-gap and cost board (AGL-1860, AGL-2252), at the staff
    // URL and under the tab it has always had.
    staffPages: [
      {
        id: 'assist-signals',
        label: 'Assist signal',
        header: {
          // The configured brand, not ours (AGL-2153/2260): a white-label
          // deployment and a self-host operator both read this header.
          title: `${PLATFORM_BRAND_NAME} Assist Signal`,
          docsTopic: 'assistSignals',
        },
        Component: AssistSignalsPage,
      },
    ],
    widgets: [
      {
        slot: 'assistPanel',
        widgetId: 'ai-assist-dock',
        title: 'Assistant',
        Component: AssistPanelOnHost,
      },
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-credits-meter',
        title: 'AI credits',
        Component: AiCreditsCard,
      },
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-credits-overage',
        title: 'AI credits overage',
        Component: BillingAssistOverageCard,
      },
      // The per-member usage (AGL-2928): who drew the credits the meter
      // counts, on Billing → Usage, on each member's page, on the staff
      // user page, and as a column of both member tables.
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-usage-by-member',
        title: 'Who is generating what',
        permission: 'billing.view',
        Component: AiTopUsersCard,
      },
      // The collaborators table's AI column (AGL-2927): whether each person
      // may open the AI doors on the site, per site, ahead of the columns
      // that report what they drew.
      {
        slot: 'hostMembers',
        widgetId: 'ai-collaborator-permissions',
        title: 'AI',
        column: { header: 'AI' },
        Component: AiCollaboratorPermissionsCell,
      },
      // The copy assistant's besigner controls (AGL-89, AGL-169): Generate a
      // section on every editor's toolbar, and Rewrite with AI under the
      // selected element's fields. Each opens the provider's dialog, and is
      // drawn only while the reader holds the door's permission.
      {
        slot: 'besignerToolbar',
        widgetId: 'ai-generate-section',
        title: 'Generate a section with AI',
        Component: AiGenerateSectionControl,
      },
      {
        slot: 'besignerInspector',
        widgetId: 'ai-rewrite-copy',
        title: 'Rewrite with AI',
        Component: AiRewriteControl,
      },
      {
        slot: 'orgMember',
        widgetId: 'ai-member-usage',
        title: 'AI usage',
        Component: MemberAiUsageCard,
      },
      // The allotments (AGL-2942): a member's or a site's monthly share of
      // the pool, set on Billing → Usage, on each member's page and on a
      // site's collaborators card — each card asks the route what its
      // reader may see and change.
      {
        slot: 'orgBillingUsage',
        widgetId: 'ai-allotments',
        title: 'AI allotments',
        permission: 'billing.view',
        Component: AiAllotmentsCard,
      },
      {
        slot: 'orgMember',
        widgetId: 'ai-member-allotment',
        title: 'AI allotment',
        Component: MemberAiAllotmentCard,
      },
      {
        slot: 'hostMembers',
        widgetId: 'ai-collaborator-allotment',
        title: 'AI allotment',
        column: {
          header: 'AI allotment',
          align: 'right',
          Header: AiCollaboratorAllotmentHeader,
        },
        Component: AiCollaboratorAllotmentCell,
      },
      {
        slot: 'hostMembers',
        widgetId: 'ai-site-allotment',
        title: 'Site AI allotment',
        Component: AiSiteAllotmentCard,
      },
      // Themes by AI (AGL-2938): a brief on the site's Theme section, a
      // proposal previewed before and after, and the editor's own Save to
      // keep it. Generation is sold as `aiGenerative` and held by
      // `ai.generate`, so the shell withholds the card from a plan or a
      // member without either; the card itself asks the route about the
      // release flag before it shows anything.
      {
        slot: 'hostTheme',
        widgetId: 'ai-theme-proposal',
        title: 'Theme assistant',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiThemeProposalCard,
      },
      {
        slot: 'staffOrg',
        widgetId: 'ai-org-usage',
        title: 'AI usage',
        Component: StaffOrgAiCard,
      },
      {
        slot: 'staffUser',
        widgetId: 'ai-account-usage',
        title: 'AI usage across organizations',
        Component: StaffUserAiUsageCard,
      },
      // The staff tables' AI figures (AGL-2984): the Organizations list's
      // spend column, and the usage table's three columns with the credit
      // pool line the org page draws above it.
      {
        slot: 'staffOrgsListColumn',
        widgetId: 'ai-orgs-spend',
        title: 'AI spend (month)',
        column: {
          header: 'AI spend (month)',
          align: 'right',
          Header: StaffOrgsAiSpendHeader,
        },
        Component: StaffOrgsAiSpendCell,
      },
      {
        slot: 'staffOrgUsageColumn',
        widgetId: 'ai-usage-assist-cost',
        title: 'Assist',
        column: { header: 'Assist', align: 'right' },
        Component: StaffOrgUsageAssistCell,
      },
      {
        slot: 'staffOrgUsageColumn',
        widgetId: 'ai-usage-credits',
        title: 'AI credits used',
        column: { header: 'AI credits used', align: 'right' },
        Component: StaffOrgUsageAiCreditsCell,
      },
      {
        slot: 'staffOrgUsageColumn',
        widgetId: 'ai-usage-overage',
        title: 'AI overage billed ($)',
        column: { header: 'AI overage billed ($)', align: 'right' },
        Component: StaffOrgUsageAiOverageCell,
      },
      {
        slot: 'staffOrgUsageColumn',
        widgetId: 'ai-usage-pool',
        title: 'AI credit pool',
        Component: StaffOrgUsageAiPool,
      },
      {
        slot: 'orgMembersListColumn',
        widgetId: 'ai-member-credits',
        title: 'AI credits (month)',
        column: { header: 'AI credits (month)', align: 'right', Header: AiMemberCreditsHeader },
        Component: AiMemberCreditsCell,
      },
      {
        slot: 'hostMembers',
        widgetId: 'ai-collaborator-credits',
        title: 'AI credits (site, month)',
        column: {
          header: 'AI credits (site, month)',
          align: 'right',
          Header: AiCollaboratorCreditsHeader,
        },
        Component: AiCollaboratorCreditsCell,
      },
      // SEO by AI (AGL-2910): "Write SEO" inside every search listing editor
      // — a page's SEO card and a product's listing — and the site audit on
      // the site's SEO section. Generation is sold as `aiGenerative` and held
      // by `ai.generate`, so the shell withholds both from a plan or a member
      // without either; each card asks the jobs route about the release flag
      // before it shows anything, and neither ever writes what it proposes.
      {
        slot: 'seoFields',
        widgetId: 'ai-seo-fields',
        title: 'SEO assistant',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiSeoFieldsCard,
      },
      {
        slot: 'hostSeo',
        widgetId: 'ai-seo-audit',
        title: 'SEO audit',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiSeoAuditCard,
      },
      // The agency batch (AGL-2911): one brief across many of the org's
      // sites, from the page that lists them. The card asks the jobs route
      // about the release flag before it shows anything, and its own door
      // holds the plan band and the caller's permission on every site it is
      // pointed at.
      {
        slot: 'orgSites',
        widgetId: 'ai-site-batch',
        title: 'Generate sites with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiSiteBatchCard,
      },
    ],
  })
}
