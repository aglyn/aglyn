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

import * as Aglyn from '@aglyn/aglyn'
import {
  registerPluginZone,
  type PluginZone,
} from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { mdiBullhornOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import {
  CAMPAIGN_DESIGN_CREATE_ZONE,
  CAMPAIGN_DESIGN_PREVIEW_ZONE,
  CAMPAIGN_SENDER_EDITOR_ZONE,
  CAMPAIGN_TOPIC_OPTIONS_ZONE,
  CAMPAIGN_TOPIC_SELECT_ZONE,
} from './components/campaign-email-zones'
import {
  EXPERIMENT_RESULT_ZONE,
  EXPERIMENT_VARIANTS_ZONE,
} from './components/experiment-zones'
import {
  MARKETING_CONSOLE_SECTIONS,
  MARKETING_ORG_CONSOLE_SECTIONS,
} from './components/marketing-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerMarketingRecordRoutes } from './model/marketing-record-routes'

/** Code-split: the Marketing console page only loads when opened. */
const MarketingConsolePage = lazy(
  () => import('./components/marketing-console-page'),
)

/** Dashboard glance card, loaded only where the shell renders the slot. */
const CampaignGlanceCard = lazy(
  () => import('./components/campaign-glance-card.component'),
)

/**
 * The campaigns drawn in the Inbox's Campaigns section: one site's, or every
 * site's on the organization's Inbox.
 */
const InboxCampaignsWidget = lazy(
  () => import('./components/inbox-campaigns-widget'),
)

/** The Emails page's Messages section: the list, one message, its composer. */
const EmailMessagesWidget = lazy(
  () => import('./components/email-messages-widget'),
)

/** Who received the sends built from one template, on the template's page. */
const EmailRecipientsCard = lazy(
  () => import('./components/email-recipients-card'),
)

/** Loaded where a record page draws one of the attribution zones. */
const RecordAttributionWidget = lazy(
  () => import('./components/record-attribution-widget'),
)

/**
 * Marketing feature plugin (AGL-395). Console-only — overlays and popups
 * render on published sites through the tenant runtime, not a canvas
 * element of their own, so there is no UI bundle. The console half declares
 * the Marketing nav + page through the ConsoleExtension registry (always-on;
 * the surface itself is not release-flagged — its overlays/A-B cards run
 * their own per-plan checks off the passed `org`). The popup image picker
 * uses the shell's media browser via `useMediaPicker`.
 */
export function registerMarketingConsole(): void {
  /*
   * The two positions the A/B testing card hosts (AGL-2914), declared before
   * the extension that draws the card. An id another plugin has already taken
   * is refused, naming both. What each zone hands a widget is carried on its
   * token, in `components/experiment-zones`, so a widget elsewhere is written
   * against the same shape without importing this plugin.
   */
  registerPluginZone(
    {
      zone: EXPERIMENT_VARIANTS_ZONE,
      label: 'A/B test variants',
      surface: 'console',
      description:
        'In the experiment editor, beside the variants. A widget here proposes copy for the variants the editor holds; the dialog’s Save is the write, and nothing a widget returns starts or changes a test.',
    },
    // Named rather than left to the loader's marker, because this function is
    // also called directly — by a spec, and by an app that loads the plugin
    // without the loader — and a zone with no owner is refused.
    { pluginId: BUNDLE_ID },
  )
  registerPluginZone(
    {
      zone: EXPERIMENT_RESULT_ZONE,
      label: 'A/B test result',
      surface: 'console',
      description:
        'Below the results of one test. A widget here explains what the figures show. There is nothing to apply, and a widget may not declare a winner the card has not.',
    },
    { pluginId: BUNDLE_ID },
  )
  /*
   * What a campaign email asks of whichever plugin keeps the mail itself —
   * the topic catalog, the sending identities, the design document and its
   * renderer. Each is a zone the composer or a message's page hosts; see
   * `components/campaign-email-zones` for what each hands a widget. All are
   * `bare`: a widget there is a field, a button, a drawer or nothing at all,
   * and the stack's spacing around it would be a gap in a form.
   */
  const bareZone = <Props,>(
    zone: PluginZone<Props>,
    label: string,
    description: string,
  ) =>
    registerPluginZone(
      { zone, label, description, surface: 'console', layout: 'bare' },
      { pluginId: BUNDLE_ID },
    )
  bareZone(
    CAMPAIGN_TOPIC_SELECT_ZONE,
    'An email’s topic',
    'In the campaign composer’s field stack. A widget here is the picker for the stream the email belongs to: it is handed the chosen id and reports a new one through `onChange`. The composer records it; the widget writes nothing.',
  )
  bareZone(
    CAMPAIGN_TOPIC_OPTIONS_ZONE,
    'The topics a campaign can open on',
    'Beside the drawers that create and edit a campaign. A widget here draws nothing: while `enabled` it reads the streams a recipient can still leave and answers through `onTopics`.',
  )
  bareZone(
    CAMPAIGN_SENDER_EDITOR_ZONE,
    'Add a sender while composing',
    'Mounted by the campaign composer once its author asks to add a sender. A widget here is that editor, open in its add mode; `onSaved` names the sender it created.',
  )
  bareZone(
    CAMPAIGN_DESIGN_CREATE_ZONE,
    'A design for one email',
    'In the campaign composer, beside the design picker. A widget here is the control that mints a design document and names it through `onCreated`; the composer records the choice on the campaign and opens the editor.',
  )
  bareZone(
    CAMPAIGN_DESIGN_PREVIEW_ZONE,
    'A sent email as an inbox receives it',
    'On one message’s page. A widget here renders the stored design, or the plain-text body, through the renderer the send path uses.',
  )
  registerMarketingRecordRoutes()
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Marketing',
    /*
     * The host dashboard's `Last campaign` card (AGL-433). A widget rather
     * than a direct import by the dashboard page, so it appears only on
     * workspaces that have the plugin that owns the campaign history — a card
     * about campaigns on a console with no campaigns page could only ever be
     * blank, and its header links straight into `/marketing/campaigns`.
     */
    widgets: [
      {
        slot: Aglyn.CONSOLE_WIDGET_SLOTS.hostDashboard,
        // The id a reader's dashboard preferences already name — it is what
        // `isDashboardWidgetHidden` and the customize order are keyed on, so
        // it is persisted and does not follow the plugin.
        widgetId: 'email-campaign-glance',
        title: 'Last campaign',
        Component: CampaignGlanceCard,
      },
      // Which campaign or link brought a person, drawn where the plugins that
      // keep and list people host a zone for it. They hand over what the
      // record is and its id; neither imports this plugin.
      {
        slot: 'crmRecordAttribution',
        widgetId: 'marketing-crm-record-attribution',
        title: 'Campaign attribution',
        Component: RecordAttributionWidget,
      },
      // The Emails page hosts its Messages section as a zone: a message is
      // one send of a campaign, and every action on it is this plugin's route.
      {
        slot: 'emailMessages',
        widgetId: 'marketing-email-messages',
        title: 'Messages',
        Component: EmailMessagesWidget,
      },
      {
        slot: 'emailTemplateRecipients',
        widgetId: 'marketing-email-template-recipients',
        title: 'Recipients',
        Component: EmailRecipientsCard,
      },
      // The Inbox's Campaigns tab is a zone; this is the card that fills it.
      {
        slot: 'inboxCampaigns',
        widgetId: 'marketing-inbox-campaigns',
        title: 'Campaigns',
        Component: InboxCampaignsWidget,
      },
      {
        slot: 'inboxRecordAttribution',
        widgetId: 'marketing-inbox-record-attribution',
        title: 'Campaign attribution',
        Component: RecordAttributionWidget,
      },
    ],
    navItems: [
      {
        label: 'Marketing',
        href: '/marketing',
        // Sections as ROUTES (AGL-2501): each is a real URL the shell
        // resolves and gates, so the page mounts the one being read.
        sections: MARKETING_CONSOLE_SECTIONS,
        navTabId: 'nav-tab-marketing',
        icon: { path: mdiBullhornOutline.path },
        header: {
          title: 'Marketing',
          icon: { path: mdiBullhornOutline.path },
          docsTopic: 'marketingOverlays',
        },
        Component: MarketingConsolePage,
      },
    ],
    /*
     * The ORGANIZATION's Marketing hub, at `/[orgSlug]/marketing`: every
     * section the site hub has, over every site. Campaigns and their sequence
     * rollups belong to the organization, so this is where one campaign is
     * placed across several sites; overlays, tests and conversions stay each
     * site's and are read across them. Every site's mail is on the
     * organization's Emails page, as a site's is on its own. The page is the
     * same component; handed no site, it renders the org sections.
     *
     * It carries the SITE tab's id on purpose, the way the org CRM tab does:
     * `release_marketing` names `nav-tab-marketing`, so one flag holds both
     * halves of the surface, and the org half cannot ship while the site half
     * is switched off.
     */
    orgNavItems: [
      {
        label: 'Marketing',
        href: '/marketing',
        sections: MARKETING_ORG_CONSOLE_SECTIONS,
        navTabId: 'nav-tab-marketing',
        icon: { path: mdiBullhornOutline.path },
        header: {
          title: 'Marketing',
          icon: { path: mdiBullhornOutline.path },
          docsTopic: 'marketingOverlays',
        },
        Component: MarketingConsolePage,
      },
    ],
  })
}

export * from './site'
