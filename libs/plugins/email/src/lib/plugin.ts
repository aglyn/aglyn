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
import { mdiEmailEditOutline, mdiEmailOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import * as Blocks from './components/email-blocks'
import { EMAILS_CONSOLE_SECTIONS } from './components/emails-console-sections'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Emails console page only loads when opened. */
const EmailsConsolePage = lazy(() => import('./components/emails-console-page'))

/**
 * Email designer feature plugin (AGL-346): email-safe blocks designed in
 * besigner like any screen — no separate editor. The render pipeline
 * (`renderEmailHtml` in @aglyn/aglyn app-utils) converts the same node
 * tree to inline-styled table HTML + plain text at send time. Follows
 * the AGL-277 bundle pattern (depends on the mui core bundle).
 */
export const EMAIL_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  { component: Blocks.EmailSection, schema: Blocks.emailSectionSchema },
  { component: Blocks.EmailText, schema: Blocks.emailTextSchema },
  { component: Blocks.EmailRichtext, schema: Blocks.emailRichtextSchema },
  { component: Blocks.EmailImage, schema: Blocks.emailImageSchema },
  { component: Blocks.EmailButton, schema: Blocks.emailButtonSchema },
  { component: Blocks.EmailDivider, schema: Blocks.emailDividerSchema },
  { component: Blocks.EmailSpacer, schema: Blocks.emailSpacerSchema },
  { component: Blocks.EmailProduct, schema: Blocks.emailProductSchema },
  {
    component: Blocks.EmailHtml,
    schema: Blocks.emailHtmlSchema,
    presets: Blocks.emailPresets,
  },
]

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
  })
}

export function registerEmailPlugin(): void {
  registerEmailConsole()
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Email Designer',
        description:
          'Email-safe blocks for designing campaign emails in the besigner',
        icon: { path: mdiEmailEditOutline.path },
        components: EMAIL_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
