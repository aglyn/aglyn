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
import { registerPluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import { mdiEmailOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import {
  EMAIL_MESSAGES_ZONE,
  EMAIL_TEMPLATE_RECIPIENTS_ZONE,
} from './components/email-zones'
import { EMAILS_CONSOLE_SECTIONS } from './components/emails-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Emails console page only loads when opened. */
const EmailsConsolePage = lazy(() => import('./components/emails-console-page'))

/*
 * What this plugin draws inside a campaign's own pages, each loaded only where
 * the campaign owner's zone is on screen.
 */
const CampaignTopicSelect = lazy(
  () => import('./components/campaign-topic-select'),
)
const CampaignTopicOptionsWidget = lazy(
  () => import('./components/campaign-topic-options-widget'),
)
const CampaignSenderEditorWidget = lazy(
  () => import('./components/campaign-sender-editor-widget'),
)
const CampaignDesignCreateWidget = lazy(
  () => import('./components/campaign-design-create-widget'),
)
const EmailDesignPreview = lazy(
  () => import('./components/email-design-preview'),
)

/**
 * Console half (AGL-395): registers the Emails nav item + page in the
 * ConsoleExtension registry. Safe to call at console app load — the page is
 * lazy, so no besigner/canvas code loads. The shell renders the Emails nav
 * item and, via its generic plugin route, the page (the messages and their
 * composer, the templates, the audience lists, the topic catalog, the sending
 * identities and the suppression list) — with no edit to the console's own
 * nav or page files.
 */
export function registerEmailConsole(): void {
  /*
   * The two places this plugin's pages hand over to whichever plugin owns
   * campaigns. A message is one send of a campaign and every action on it is
   * that plugin's route, so the Messages section is a zone this page hosts
   * rather than pages this plugin imports; the same holds for the recipients
   * table under a template's report. Named, because a spec calls this
   * registrar without the loader.
   */
  registerPluginZone(
    {
      zone: EMAIL_MESSAGES_ZONE,
      label: 'The Emails page’s Messages section',
      surface: 'console',
      layout: 'bare',
      description:
        'The whole body of `/emails/messages` and the routes under it, under a site and on the organization’s Emails page. A widget here is handed the site (or `null` and the org mount at the organization level), the Emails page’s base path and the segments under `messages`, and draws the list, one message’s report or its composer.',
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginZone(
    {
      zone: EMAIL_TEMPLATE_RECIPIENTS_ZONE,
      label: 'Who received a template’s emails',
      surface: 'console',
      description:
        'On one template’s page, under its report. A widget here lists the recipients of every send built from that template; it is handed the site and the template’s screen id.',
    },
    { pluginId: BUNDLE_ID },
  )
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Email',
    /*
     * WHO may open the email console, declared so the shell enforces it.
     *
     * The audiences section reads `orgs/{orgId}/lists/{listId}/members`, and
     * those members are enrolled CONTACTS — an address, a name, and the
     * consent basis recording why the person may be mailed. That is the same
     * org-shared people data the CRM holds, reached from a different page.
     *
     * The rules gate those reads on `isOrgWideMember()` ALONE, with no role
     * condition, so org-wide membership of any role is enough to list every
     * audience the organization has and everybody on it. An org VIEWER — the
     * role that exists to read and change nothing — therefore reads the whole
     * marketing audience today. `data.manage` is what closes that: it
     * defaults to owner, admin and editor, so the population it admits is
     * exactly the one `server-list-gate.ts` accepts a list write from, and
     * the viewer it excludes is the reader the rules never excluded.
     *
     * `data.manage` rather than a key of this plugin's own for the reason the
     * catalog gives for refusing a `marketing.manage`: campaigns are written
     * client-direct against rules that gate on the HOST role, so a new
     * org-level key would name an action with no org-level boundary under it.
     * `data.manage` is not in that position — it already governs the
     * org-shared data this surface exposes, and the list gate already reads
     * the roles it defaults to.
     *
     * A SITE COLLABORATOR holding it opens the page, and the answer is NOT
     * the one Contacts reached. There the listener is scoped and the rules
     * prove the same predicate per document; here the audiences read demands
     * `isOrgWideMember()`, which a collaborator is not, so the org-shared
     * half is already refused beneath the console and the half that remains —
     * this site's own messages, templates and sending identities — is theirs.
     * Refusing the surface outright would take that away to close nothing.
     */
    permission: 'data.manage',
    /*
     * The mail a campaign rides on is this plugin's — the topic catalog, the
     * sending identities, the design document and its renderer — so each is
     * drawn here, in a zone the campaign owner's composer and message page
     * host. Every one reports through a callback; none writes a campaign.
     */
    widgets: [
      {
        slot: 'campaignTopicSelect',
        widgetId: 'email-campaign-topic-select',
        title: 'Topic',
        Component: CampaignTopicSelect,
      },
      {
        slot: 'campaignTopicOptions',
        widgetId: 'email-campaign-topic-options',
        title: 'Topics',
        Component: CampaignTopicOptionsWidget,
      },
      {
        slot: 'campaignSenderEditor',
        widgetId: 'email-campaign-sender-editor',
        title: 'Add a sender',
        Component: CampaignSenderEditorWidget,
      },
      {
        slot: 'campaignDesignCreate',
        widgetId: 'email-campaign-design-create',
        title: 'Design this email',
        Component: CampaignDesignCreateWidget,
      },
      {
        slot: 'campaignDesignPreview',
        widgetId: 'email-campaign-design-preview',
        title: 'Preview',
        Component: EmailDesignPreview,
      },
    ],
    navItems: [
      {
        label: 'Emails',
        href: '/emails',
        icon: { path: mdiEmailOutline.path },
        // Sections as ROUTES (AGL-2501): `/emails/messages` and friends are
        // real URLs the shell resolves and gates, so the page mounts the one
        // being read instead of subscribing all six.
        sections: EMAILS_CONSOLE_SECTIONS,
        header: {
          title: 'Emails',
          icon: { path: mdiEmailOutline.path },
          docsTopic: 'emailCampaigns',
        },
        Component: EmailsConsolePage,
      },
    ],
    /*
     * The ORGANIZATION's Emails page, at `/[orgSlug]/emails`: the same six
     * sections over every site. The audiences and the topics are the org's
     * already; the messages, the templates, the sending identities and the
     * suppression lists are read site by site and link into the site that
     * holds them. The page is the same component — handed no site, it renders
     * the org sections.
     *
     * No `navTabId`, the same as the site tab: this plugin's release flag
     * gates the plugin itself, so one flag already holds both levels.
     */
    orgNavItems: [
      {
        label: 'Emails',
        href: '/emails',
        icon: { path: mdiEmailOutline.path },
        sections: EMAILS_CONSOLE_SECTIONS,
        header: {
          title: 'Emails',
          icon: { path: mdiEmailOutline.path },
          docsTopic: 'emailCampaigns',
        },
        Component: EmailsConsolePage,
      },
    ],
  })
}

export * from './site'
