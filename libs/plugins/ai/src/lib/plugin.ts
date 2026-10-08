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

import { PLATFORM_BRAND_NAME, aiAddonName, registerConsoleExtension } from '@aglyn/aglyn'
import { LinearProgress } from '@mui/material'
import { createElement } from 'react'
import { AiAssistProviderOnHost } from './components/ai-assist-provider-on-host.component'
import { AI_PLUGIN_ID } from './constants'
import { registerAiDeclarations } from './declarations'
import { lazyWidget } from './lazy-widget'

/*
 * Every component below is registered by name and loaded the first time the
 * shell draws it (AGL-3649); see `lazyWidget`. The console loads this plugin
 * on every screen, so a static import of a component here is downloaded by
 * every reader of every page, staff cards included.
 */

/** What a page shows while its code arrives. */
const PAGE_LOADING = createElement(LinearProgress, { 'aria-label': 'Loading' })

const AiCollaboratorPermissionsCell = lazyWidget(
  'AiCollaboratorPermissionsCell',
  () =>
    import('./components/ai-collaborator-permissions-column.component').then(
      (m) => m.AiCollaboratorPermissionsCell,
    ),
)
const AiSaveAsComponent = lazyWidget('AiSaveAsComponent', () =>
  import('./components/ai-save-as-component.component').then(
    (m) => m.AiSaveAsComponent,
  ),
)
const AiGenerateSectionControl = lazyWidget('AiGenerateSectionControl', () =>
  import('./components/besigner-ai-controls.component').then(
    (m) => m.AiGenerateSectionControl,
  ),
)
const AiRewriteControl = lazyWidget('AiRewriteControl', () =>
  import('./components/besigner-ai-controls.component').then(
    (m) => m.AiRewriteControl,
  ),
)
const AssistPanelOnHost = lazyWidget('AssistPanelOnHost', () =>
  import('./components/ai-permissions-on-host.component').then(
    (m) => m.AssistPanelOnHost,
  ),
)
const AiCreditsCard = lazyWidget('AiCreditsCard', () =>
  import('./components/ai-credits-card.component').then((m) => m.default),
)
const AiJobsTopBarIndicator = lazyWidget('AiJobsTopBarIndicator', () =>
  import('./components/ai-jobs-indicator.component').then((m) => m.default),
)
const AiCollaboratorCreditsCell = lazyWidget('AiCollaboratorCreditsCell', () =>
  import('./components/ai-credits-columns.component').then(
    (m) => m.AiCollaboratorCreditsCell,
  ),
)
const AiCollaboratorCreditsHeader = lazyWidget(
  'AiCollaboratorCreditsHeader',
  () =>
    import('./components/ai-credits-columns.component').then(
      (m) => m.AiCollaboratorCreditsHeader,
    ),
)
const AiMemberCreditsCell = lazyWidget('AiMemberCreditsCell', () =>
  import('./components/ai-credits-columns.component').then(
    (m) => m.AiMemberCreditsCell,
  ),
)
const AiMemberCreditsHeader = lazyWidget('AiMemberCreditsHeader', () =>
  import('./components/ai-credits-columns.component').then(
    (m) => m.AiMemberCreditsHeader,
  ),
)
const AssistSignalsPage = lazyWidget(
  'AssistSignalsPage',
  () =>
    import('./components/assist-signals-page.component').then(
      (m) => m.AssistSignalsPage,
    ),
  PAGE_LOADING,
)
const BillingAssistOverageCard = lazyWidget('BillingAssistOverageCard', () =>
  import('./components/billing-assist-overage-card.component').then(
    (m) => m.default,
  ),
)
const AiTopUsersCard = lazyWidget('AiTopUsersCard', () =>
  import('./components/billing-ai-top-users.component').then(
    (m) => m.AiTopUsersCard,
  ),
)
const AiAllotmentsCard = lazyWidget('AiAllotmentsCard', () =>
  import('./components/billing-ai-allotments.component').then(
    (m) => m.AiAllotmentsCard,
  ),
)
const AiCollaboratorAllotmentCell = lazyWidget(
  'AiCollaboratorAllotmentCell',
  () =>
    import('./components/host-ai-allotments.component').then(
      (m) => m.AiCollaboratorAllotmentCell,
    ),
)
const AiCollaboratorAllotmentHeader = lazyWidget(
  'AiCollaboratorAllotmentHeader',
  () =>
    import('./components/host-ai-allotments.component').then(
      (m) => m.AiCollaboratorAllotmentHeader,
    ),
)
const AiSiteAllotmentCard = lazyWidget('AiSiteAllotmentCard', () =>
  import('./components/host-ai-allotments.component').then(
    (m) => m.AiSiteAllotmentCard,
  ),
)
const MemberAiAllotmentCard = lazyWidget('MemberAiAllotmentCard', () =>
  import('./components/member-ai-allotment-card.component').then(
    (m) => m.default,
  ),
)
const MemberAiUsageCard = lazyWidget('MemberAiUsageCard', () =>
  import('./components/member-ai-usage-card.component').then((m) => m.default),
)
const AiThemeProposalCard = lazyWidget('AiThemeProposalCard', () =>
  import('./components/ai-theme-proposal-card.component').then(
    (m) => m.default,
  ),
)
const StaffOrgAiCard = lazyWidget('StaffOrgAiCard', () =>
  import('./components/staff-org-ai-card.component').then((m) => m.default),
)
const StaffOrgAiConversations = lazyWidget('StaffOrgAiConversations', () =>
  import('./components/staff-org-ai-conversations.component').then((m) => m.default),
)
const StaffOrgUsageAiCreditsCell = lazyWidget(
  'StaffOrgUsageAiCreditsCell',
  () =>
    import('./components/staff-org-usage-ai-columns.component').then(
      (m) => m.StaffOrgUsageAiCreditsCell,
    ),
)
const StaffOrgUsageAiOverageCell = lazyWidget(
  'StaffOrgUsageAiOverageCell',
  () =>
    import('./components/staff-org-usage-ai-columns.component').then(
      (m) => m.StaffOrgUsageAiOverageCell,
    ),
)
const StaffOrgUsageAiPool = lazyWidget('StaffOrgUsageAiPool', () =>
  import('./components/staff-org-usage-ai-columns.component').then(
    (m) => m.StaffOrgUsageAiPool,
  ),
)
const StaffOrgUsageAssistCell = lazyWidget('StaffOrgUsageAssistCell', () =>
  import('./components/staff-org-usage-ai-columns.component').then(
    (m) => m.StaffOrgUsageAssistCell,
  ),
)
const StaffOrgsAiSpendCell = lazyWidget('StaffOrgsAiSpendCell', () =>
  import('./components/staff-orgs-ai-spend-column.component').then(
    (m) => m.StaffOrgsAiSpendCell,
  ),
)
const StaffOrgsAiSpendHeader = lazyWidget('StaffOrgsAiSpendHeader', () =>
  import('./components/staff-orgs-ai-spend-column.component').then(
    (m) => m.StaffOrgsAiSpendHeader,
  ),
)
const StaffUserAiUsageCard = lazyWidget('StaffUserAiUsageCard', () =>
  import('./components/staff-user-ai-usage-card.component').then(
    (m) => m.default,
  ),
)
const AiSeoAuditCard = lazyWidget('AiSeoAuditCard', () =>
  import('./components/ai-seo-audit-card.component').then((m) => m.default),
)
const AiSiteBatchCard = lazyWidget('AiSiteBatchCard', () =>
  import('./components/ai-site-batch-card.component').then((m) => m.default),
)
const AiSiteSeoStartCard = lazyWidget('AiSiteSeoStartCard', () =>
  import('./components/ai-site-seo-start-card.component').then(
    (m) => m.default,
  ),
)
const AiSiteMemoryCard = lazyWidget('AiSiteMemoryCard', () =>
  import('./components/ai-site-memory-card.component').then((m) => m.default),
)
const AiSiteStartCard = lazyWidget('AiSiteStartCard', () =>
  import('./components/ai-site-start-card.component').then((m) => m.default),
)
const AiSeoFieldsCard = lazyWidget('AiSeoFieldsCard', () =>
  import('./components/ai-seo-fields-card.component').then((m) => m.default),
)
const AiDescribeAutomationButton = lazyWidget(
  'AiDescribeAutomationButton',
  () =>
    import('./components/ai-describe-automation.component').then(
      (m) => m.default,
    ),
)
const AiReviseAutomation = lazyWidget('AiReviseAutomation', () =>
  import('./components/ai-revise-automation.component').then((m) => m.default),
)
const AiDescribeOrgAutomationButton = lazyWidget(
  'AiDescribeOrgAutomationButton',
  () =>
    import('./components/ai-describe-org-automation.component').then(
      (m) => m.default,
    ),
)
const AiInsightHostCard = lazyWidget('AiInsightHostCard', () =>
  import('./components/ai-insight-card.component').then(
    (m) => m.AiInsightHostCard,
  ),
)
const AiInsightOrgCard = lazyWidget('AiInsightOrgCard', () =>
  import('./components/ai-insight-card.component').then(
    (m) => m.AiInsightOrgCard,
  ),
)
const AiLogicCreateButton = lazyWidget('AiLogicCreateButton', () =>
  import('./components/ai-logic.component').then((m) => m.AiLogicCreateButton),
)
const AiLogicFixReference = lazyWidget('AiLogicFixReference', () =>
  import('./components/ai-logic.component').then((m) => m.AiLogicFixReference),
)
const AiLogicFunctionTools = lazyWidget('AiLogicFunctionTools', () =>
  import('./components/ai-logic.component').then((m) => m.AiLogicFunctionTools),
)
const AiFunnelAskButton = lazyWidget('AiFunnelAskButton', () =>
  import('./components/ai-funnel-zones.component').then(
    (m) => m.AiFunnelAskButton,
  ),
)
const AiFunnelCreateButton = lazyWidget('AiFunnelCreateButton', () =>
  import('./components/ai-funnel-zones.component').then(
    (m) => m.AiFunnelCreateButton,
  ),
)
const AiCrmEmailDraft = lazyWidget('AiCrmEmailDraft', () =>
  import('./components/ai-crm-email-draft.component').then((m) => m.default),
)
const AiCrmImportMapping = lazyWidget('AiCrmImportMapping', () =>
  import('./components/ai-crm-import-mapping.component').then((m) => m.default),
)
const AiCrmRecordCard = lazyWidget('AiCrmRecordCard', () =>
  import('./components/ai-crm-record-card.component').then((m) => m.default),
)
const AiDescribePageButton = lazyWidget('AiDescribePageButton', () =>
  import('./components/ai-describe-page.component').then((m) => m.default),
)
const AiMediaCreateButton = lazyWidget('AiMediaCreateButton', () =>
  import('./components/ai-media-create.component').then((m) => m.default),
)
const AiDescribeComponentButton = lazyWidget('AiDescribeComponentButton', () =>
  import('./components/ai-describe-button.component').then(
    (m) => m.AiDescribeComponentButton,
  ),
)
const AiDescribeFormButton = lazyWidget('AiDescribeFormButton', () =>
  import('./components/ai-describe-button.component').then(
    (m) => m.AiDescribeFormButton,
  ),
)
const AiDescribeLayoutButton = lazyWidget('AiDescribeLayoutButton', () =>
  import('./components/ai-describe-button.component').then(
    (m) => m.AiDescribeLayoutButton,
  ),
)
const AiDescribeTemplateButton = lazyWidget('AiDescribeTemplateButton', () =>
  import('./components/ai-describe-button.component').then(
    (m) => m.AiDescribeTemplateButton,
  ),
)
const AiDescribeEmailButton = lazyWidget('AiDescribeEmailButton', () =>
  import('./components/ai-describe-email.component').then(
    (m) => m.AiDescribeEmailButton,
  ),
)
const AiExperimentResultCard = lazyWidget('AiExperimentResultCard', () =>
  import('./components/ai-experiment-cards.component').then(
    (m) => m.AiExperimentResultCard,
  ),
)
const AiExperimentVariantsCard = lazyWidget('AiExperimentVariantsCard', () =>
  import('./components/ai-experiment-cards.component').then(
    (m) => m.AiExperimentVariantsCard,
  ),
)
const AiExplainAutomation = lazyWidget('AiExplainAutomation', () =>
  import('./components/ai-explain-automation.component').then(
    (m) => m.AiExplainAutomation,
  ),
)
const AiExplainRunFailure = lazyWidget('AiExplainRunFailure', () =>
  import('./components/ai-explain-automation.component').then(
    (m) => m.AiExplainRunFailure,
  ),
)
const AiCreateCampaignButton = lazyWidget('AiCreateCampaignButton', () =>
  import('./components/ai-campaign-create.component').then((m) => m.default),
)
const AiMarketingInsightButton = lazyWidget('AiMarketingInsightButton', () =>
  import('./components/ai-marketing-insight.component').then((m) => m.default),
)
const AiCreateOverlayButton = lazyWidget('AiCreateOverlayButton', () =>
  import('./components/ai-overlay-cards.component').then(
    (m) => m.AiCreateOverlayButton,
  ),
)
const AiOverlayEditorCard = lazyWidget('AiOverlayEditorCard', () =>
  import('./components/ai-overlay-cards.component').then(
    (m) => m.AiOverlayEditorCard,
  ),
)
const AiProductCopyCard = lazyWidget('AiProductCopyCard', () =>
  import('./components/ai-product-copy-card.component').then((m) => m.default),
)
const AiProductImportOption = lazyWidget('AiProductImportOption', () =>
  import('./components/ai-product-import-option.component').then(
    (m) => m.default,
  ),
)
const AiProductsHubCard = lazyWidget('AiProductsHubCard', () =>
  import('./components/ai-products-hub-card.component').then((m) => m.default),
)
const AiCreateProductsButton = lazyWidget('AiCreateProductsButton', () =>
  import('./components/ai-products-create-button.component').then(
    (m) => m.default,
  ),
)
const AiJobsPage = lazyWidget(
  'AiJobsPage',
  () => import('./components/ai-jobs-page.component').then((m) => m.default),
  PAGE_LOADING,
)

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
    // A site's AI jobs (AGL-3596), an address under the site and no tab:
    // `/ai-jobs` lists them, and `/ai-jobs/{jobId}` is one job's page —
    // "Building your site" (AGL-3594), where the guided start lands a person
    // and where a site job's notification opens. The `href` is a literal,
    // `AI_SITE_BUILD_HREF`'s value, because the tab-title manifest is read
    // from this source (`ai-jobs-page.spec.tsx` holds the two equal).
    navItems: [
      {
        label: 'AI jobs',
        href: '/ai-jobs',
        recordTitle: 'Building your site',
        header: { title: 'AI jobs', docsTopic: 'howAglynAiBuilds', docsAnchor: '#finding-your-ai-jobs' },
        unlisted: true,
        ownsSubtree: true,
        permission: 'ai.generate',
        Component: AiJobsPage,
      },
    ],
    widgets: [
      {
        slot: 'consoleDock',
        widgetId: 'ai-assist-dock',
        title: 'Assistant',
        Component: AssistPanelOnHost,
      },
      // The AI jobs indicator (AGL-3593), beside the notifications bell on
      // every page: what the workspace's jobs are doing, and the way to them.
      // Gated as the other generative widgets are; it asks the shell for the
      // release flags of the jobs and of the panel it opens.
      {
        slot: 'consoleTopBar',
        widgetId: 'ai-jobs-indicator',
        title: 'AI jobs',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiJobsTopBarIndicator,
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
      // Save the selection as a reusable component (AGL-2908): the component
      // job's second entry point, which proposes the properties a section
      // should declare and applies them as the manual promote does.
      {
        slot: 'besignerInspector',
        widgetId: 'ai-save-as-component',
        title: 'Make a reusable component with AI',
        permission: 'ai.generate',
        Component: AiSaveAsComponent,
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
        slot: 'staffOrg',
        widgetId: 'ai-org-conversations',
        title: 'AI conversations',
        Component: StaffOrgAiConversations,
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
      // A page from a brief (AGL-2907): "Create with AI" beside Templates and
      // Create New Screen. Gated as the other generative widgets are.
      // On a plan that could buy the AI add-on and has not, each "Create with
      // AI" entry here is mounted anyway (`showWhenNotEntitled`) and opens
      // the add-on's dialog instead of the brief (AGL-3601). The shell holds
      // each behind `release_ai_generative` too, so an entry draws at once
      // and asks the jobs route nothing until its brief is sent.
      {
        slot: 'hostScreens',
        widgetId: 'ai-describe-page',
        title: 'Describe a page',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribePageButton,
      },
      // The same entry for a page template, a layout and a form (AGL-3043),
      // beside the create action of the page that lists each: the same
      // dialog and the same gates.
      {
        slot: 'hostTemplates',
        widgetId: 'ai-describe-template',
        title: 'Describe a page template',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeTemplateButton,
      },
      {
        slot: 'hostLayouts',
        widgetId: 'ai-describe-layout',
        title: 'Describe a layout',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeLayoutButton,
      },
      {
        slot: 'hostForms',
        widgetId: 'ai-describe-form',
        title: 'Describe a form',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeFormButton,
      },
      // And a reusable component from a brief (AGL-3051), beside Templates
      // and Create Component: the component job's first entry point, which
      // had none in the console.
      // Pictures from a description (AGL-3602): "Create with AI" beside Upload
      // media in the media library, and in its empty state. Gated as the
      // other generative widgets are, by the shell alone: it asks nothing of
      // a server until someone creates a picture, and the door decides then.
      {
        slot: 'mediaLibrary',
        widgetId: 'ai-media-create',
        title: 'Create images with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiMediaCreateButton,
      },
      {
        slot: 'hostComponents',
        widgetId: 'ai-describe-component',
        title: 'Describe a reusable component',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeComponentButton,
      },
      // An email design from a brief (AGL-3596), beside New template on a
      // site's email templates — the zone the email plugin hosts. Its dialog
      // also offers the draft campaign that would send it; the Campaigns
      // section's own door is `ai-create-campaign`, below.
      {
        slot: 'hostEmailTemplates',
        widgetId: 'ai-describe-email',
        title: 'Describe an email',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeEmailButton,
      },
      // Automations by AI (AGL-2919), in the zones the workflows plugin hosts
      // on its Automation page: "Create with AI" beside Add action and Recipes,
      // "Explain it" in the editor of a saved automation, and "Why did this
      // fail?" on a failed run. Gated as the other generative widgets are,
      // the release flag included, by the shell alone (AGL-3601): none asks
      // the jobs route anything until it is used, and none of them changes an
      // automation.
      {
        slot: 'hostAutomations',
        widgetId: 'ai-describe-automation',
        title: 'Describe an automation',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeAutomationButton,
      },
      // Funnels by AI (AGL-3605), in the zones the funnels plugin hosts on
      // its card: a draft from a description, and its results explained.
      {
        slot: 'funnelsCreate',
        widgetId: 'ai-describe-funnel',
        title: 'Describe a funnel',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiFunnelCreateButton,
      },
      {
        slot: 'funnelInsight',
        widgetId: 'ai-explain-funnel',
        title: 'Ask AI about this funnel',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiFunnelAskButton,
      },
      {
        slot: 'automationEditor',
        widgetId: 'ai-explain-automation',
        title: 'Explain this automation',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiExplainAutomation,
      },
      // "Change with AI" and "Fix with AI" in a saved action's editor
      // (AGL-3603): a changed copy drafted OFF beside it, never the saved
      // action written in place.
      {
        slot: 'automationEditor',
        widgetId: 'ai-revise-automation',
        title: 'Change this automation with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiReviseAutomation,
      },
      // "Create with AI" on the workspace's Org automations (AGL-3603): one
      // of the workspace's automations drafted from a description and opened
      // in that section's editor, unsaved and switched off.
      {
        slot: 'orgAutomations',
        widgetId: 'ai-describe-org-automation',
        title: 'Describe an org automation',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiDescribeOrgAutomationButton,
      },
      // "Ask AI about these numbers" (AGL-3603): a tile on a site's
      // dashboard and Analytics page, which both draw `hostDashboard`, and on
      // the workspace's sites page. It opens the insight dialog the Assist
      // panel opens, gated as every generative widget is.
      {
        slot: 'hostDashboard',
        widgetId: 'ai-insight-ask',
        title: 'Ask AI about these numbers',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiInsightHostCard,
      },
      {
        slot: 'orgDashboard',
        widgetId: 'ai-insight-ask',
        title: 'Ask AI about these numbers',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiInsightOrgCard,
      },
      // Logic by AI (AGL-3603), in the zones the logic plugin hosts on its
      // Functions & Variables page: Create with AI in the Functions and
      // Variables card headers, Explain / Change / Fix in a saved function's
      // editor, and Fix with AI on a broken reference an automation holds.
      // Each proposal opens unsaved in the logic editor; none is saved here.
      {
        slot: 'hostLogic',
        widgetId: 'ai-describe-logic',
        title: 'Describe a function or variable',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiLogicCreateButton,
      },
      {
        slot: 'logicFunctionEditor',
        widgetId: 'ai-logic-function',
        title: 'This function with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiLogicFunctionTools,
      },
      {
        slot: 'logicReferenceIssue',
        widgetId: 'ai-logic-fix-reference',
        title: 'Fix this reference with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiLogicFixReference,
      },
      {
        slot: 'automationRun',
        widgetId: 'ai-explain-run-failure',
        title: 'Why did this run fail?',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiExplainRunFailure,
      },
      // CRM by AI (AGL-2917): a record's summary and next step on its page,
      // a draft in the one-to-one composer, and an import's column matches.
      // The CRM hosts each zone, so it is drawn only where the CRM is; the
      // shell holds the plan and `ai.generate`, each card asks the jobs route
      // about the release flag before it shows anything, and none writes what
      // it proposes.
      {
        slot: 'recordInsights',
        widgetId: 'ai-crm-record',
        title: 'AI summary',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiCrmRecordCard,
      },
      {
        slot: 'recordEmail',
        widgetId: 'ai-crm-email',
        title: 'Draft with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiCrmEmailDraft,
      },
      {
        slot: 'importMapping',
        widgetId: 'ai-crm-import-mapping',
        title: 'Match columns with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiCrmImportMapping,
      },
      // The guided start (AGL-2918), on the page a newly created site lands
      // on: a few questions that become a site scaffold. Gated as the other
      // generative widgets are, and it asks the jobs route about the release
      // flag before it shows anything — so a workspace the feature is not
      // released to gets the blank page and nothing else. Skipping is the
      // zone's own `startBlank`, which creates nothing.
      {
        slot: 'hostFirstRun',
        widgetId: 'ai-site-start',
        title: 'Start this site with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiSiteStartCard,
      },
      // The listing those answers describe (AGL-2918), on the site's SEO
      // section: the site-wide search title and description the guided start
      // implies, offered where they are edited. The same gates as every
      // generative widget, and it stages into the SEO form rather than
      // writing it — a person's Update is the write, as it is for the audit
      // card beside it.
      {
        slot: 'hostSeo',
        widgetId: 'ai-site-seo-start',
        title: 'The listing your answers describe',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiSiteSeoStartCard,
      },
      // What Aglyn AI learned from the site's applied edits (AGL-3661), on
      // Setup → Business profile, where the owner reads and forgets it. No
      // generate permission: reading and clearing what the AI keeps about a
      // site is every editor's, and the rules hold the write to the server.
      {
        slot: 'hostBusinessProfile',
        widgetId: 'ai-site-memory',
        title: `What ${aiAddonName()} learned`,
        featureFlag: 'aiGenerative',
        Component: AiSiteMemoryCard,
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
      // Commerce by AI (AGL-2916): product copy in the product editor, the
      // catalog, categories and discounts on the products hub, and copy for
      // an import as it lands. The commerce plugin hosts the zones and makes
      // every write. The shell holds the release flag; the products hub card
      // reads its recent proposals before it draws its own controls, but
      // offers the "Create with AI" door's brief from the moment it mounts.
      {
        slot: 'productEditor',
        widgetId: 'ai-product-copy',
        title: 'Product copy assistant',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiProductCopyCard,
      },
      {
        slot: 'productsHub',
        widgetId: 'ai-products-hub',
        title: 'Build your catalog with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiProductsHubCard,
      },
      // "Create with AI" beside Add product and in the empty catalog
      // (AGL-3596): a door to the card's Propose products brief, shown only
      // while that card is on the page to take it.
      {
        slot: 'productsCreate',
        widgetId: 'ai-products-create',
        title: 'Propose products',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiCreateProductsButton,
      },
      {
        slot: 'productImport',
        widgetId: 'ai-product-import',
        title: 'Write imported product copy with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        Component: AiProductImportOption,
      },
      // A/B tests by AI (AGL-2914): variants written in the experiment
      // editor, and one test's result read in plain words below its figures.
      // The A/B testing card hosts both zones, so they are drawn only where
      // that card is and only on a site with A/B testing; the shell holds the
      // plan band, `ai.generate` and the release flag, and neither card asks
      // the jobs route anything until it is used (AGL-3601). Neither writes: the
      // experiment editor's Save is the only write, and an explanation has
      // nothing to apply.
      {
        slot: 'experimentVariants',
        widgetId: 'ai-experiment-variants',
        title: 'Write variants with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiExperimentVariantsCard,
      },
      {
        slot: 'experimentResult',
        widgetId: 'ai-experiment-result',
        title: 'Explain this result with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiExperimentResultCard,
      },
      // Overlays by AI (AGL-3603), in the zones the marketing plugin's
      // overlays list hosts: "Create with AI" beside New bar and New popup,
      // and "Write with AI" among the overlay editor's fields. Both start a
      // `text` job asked for overlay copy; neither writes — the list saves a
      // created overlay switched off, and the editor's Save is the write.
      {
        slot: 'hostOverlays',
        widgetId: 'ai-create-overlay',
        title: 'Create an overlay with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiCreateOverlayButton,
      },
      {
        slot: 'overlayEditor',
        widgetId: 'ai-overlay-copy',
        title: 'Write overlay copy with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        releaseFlag: 'release_ai_generative',
        Component: AiOverlayEditorCard,
      },
      // A campaign from a brief (AGL-3603), beside Create campaign on the
      // Campaigns section the marketing plugin hosts: the `campaign` job's
      // first console door, or the `email` job's where the plan sends no
      // campaign email. Both write drafts that are aimed at nobody and sent
      // by nobody until a member does.
      {
        slot: 'hostCampaigns',
        widgetId: 'ai-create-campaign',
        title: 'Create a campaign with AI',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiCreateCampaignButton,
      },
      // The figures in words (AGL-3603), in the header of the Conversions
      // section and of one campaign's report: the insight dialog the Assist
      // panel opens, on the Marketing surface, for the site the figures are.
      // It reads and cites; it changes nothing.
      {
        slot: 'marketingInsights',
        widgetId: 'ai-marketing-insight',
        title: 'Ask AI about these numbers',
        featureFlag: 'aiGenerative',
        permission: 'ai.generate',
        showWhenNotEntitled: true,
        releaseFlag: 'release_ai_generative',
        Component: AiMarketingInsightButton,
      },
    ],
  })
}
