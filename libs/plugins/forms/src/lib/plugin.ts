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
import { mdiEmailFastOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import * as FormComponents from './components/form'
import { BUNDLE_ID } from './constants/bundle-common'

/** Code-split: the Forms console surface only loads when opened. */
const FormsConsolePage = lazy(() => import('./components/forms-console-page'))

/**
 * The canvas half: the form and the fields inside it.
 *
 * `formField` ships beside `form` rather than staying with the generic
 * elements because it is not a generic input — it publishes its own
 * name/dataset mapping to the enclosing form through a hidden input, and a
 * field with no form around it submits nowhere.
 */
export const FORMS_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: FormComponents.Form,
    schema: FormComponents.formSchema,
    presets: FormComponents.formPresets,
  },
  {
    component: FormComponents.FormField,
    schema: FormComponents.formFieldSchema,
    // The composed Contact Section, offered under Sections & Blocks. It hangs
    // off the FIELD entry only because the registry reads presets per entry;
    // what it places is the form above.
    presets: FormComponents.formBlockPresets,
  },
]

/**
 * Console half: the Forms catalog and one form's own surface, served by the
 * shell's generic plugin route.
 *
 * `ownsSubtree` because a form's detail URL names a document id rather than a
 * declared section. Safe to call at console app load — the page is lazy.
 */
export function registerFormsConsole(): void {
  Aglyn.registerConsoleExtension({
    pluginId: BUNDLE_ID,
    displayName: 'Forms',
    navItems: [
      {
        label: 'Forms',
        href: '/forms',
        // The tab id the console has always keyed this surface's active state
        // on. It carries no release flag: forms is always-on.
        navTabId: 'nav-tab-forms',
        icon: { path: mdiEmailFastOutline.path },
        ownsSubtree: true,
        header: {
          title: 'Forms',
          icon: { path: mdiEmailFastOutline.path },
          docsTopic: 'forms',
        },
        Component: FormsConsolePage,
      },
    ],
  })
}

/**
 * Forms feature plugin: a canvas element and a console surface, the shape a
 * capability with both halves takes.
 *
 * ## Why this bundle is always-on
 *
 * Its server half is not switchable. `/api/forms/submit` is a core tenant
 * route, `form-contract.ts` is a core module the publish path runs, and
 * neither consults `org.enabledPlugins` — because `libs/tenant/runtime` is
 * `scope:aglyn` and the module graph forbids core from importing a plugin at
 * all. A gate on the bundle would therefore switch off only the half that
 * DRAWS the form: a published contact page would render a hole while the
 * endpoint behind it kept answering, and the site owner would learn about it
 * from whoever stopped writing in.
 *
 * That is the `product` hazard inverted, and worse, because a form has no
 * second element to fall back on. So `forms` carries `alwaysOn: true` in the
 * catalog, and therefore no release flag — `resolveEnabledPlugins` unions it
 * into every org's set and `subtractDisabledPlugins` keeps it through a
 * site's deny-list.
 *
 * Always-on is not the same as always-loaded. `requiredSitePlugins` narrows
 * the pre-render set by each node's `pluginId`, so a page with no form on it
 * does not wait for this bundle — which is the saving the move buys, since
 * every page used to carry the form element inside `mui`.
 */
export function registerFormsPlugin(): void {
  registerFormsConsole()
  if (Aglyn.plugins.getDependency(BUNDLE_ID)) return
  Aglyn.plugins.addDependency(
    Aglyn.defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Forms',
        description: 'Forms and their fields: contact, signup, survey',
        icon: { path: mdiEmailFastOutline.path },
        components: FORMS_BUNDLE,
      },
      Aglyn.components,
    ),
  )
}
