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
import * as PluginSdk from '@aglyn/aglyn'
import { mdiEmailEditOutline, mdiEmailOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import * as Blocks from './components/email-blocks'
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
export const EMAIL_BUNDLE: PluginSdk.FeatureBundleEntry[] = [
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
 * item and, via its generic plugin route, the page (campaigns composer,
 * audience lists, and the dedicated email-screens list) — with no edit to
 * the console's own nav or page files.
 */
export function registerEmailConsole(): void {
  PluginSdk.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Email',
    navItems: [
      {
        label: 'Emails',
        href: '/emails',
        icon: { path: mdiEmailOutline.path },
        header: { title: 'Emails', icon: { path: mdiEmailOutline.path } },
        Component: EmailsConsolePage,
      },
    ],
  })
}

export function registerEmailPlugin(): void {
  registerEmailConsole()
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    PluginSdk.defineUiFeatureBundle(
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
