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
import * as FormComponents from './components/form'
import { BUNDLE_ID } from './constants/bundle-common'

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
 * Forms feature plugin: a canvas element and a console surface, the shape a
 * capability with both halves takes.
 *
 * ## On for every workspace, switchable per site (AGL-3029)
 *
 * A form has two halves, and only one of them is this bundle. The bundle
 * DRAWS the form; its server half is core — `/api/forms/submit` is a core
 * tenant route and `form-contract.ts` a core module the publish path runs —
 * because core may not import a plugin. A switch on the bundle alone would
 * stop only the drawing: a published contact page would render a hole while
 * the endpoint behind it kept answering.
 *
 * So the switch is not the bundle's. `forms` carries `alwaysOnForWorkspace`
 * in the catalog — the catalog and the submissions already stored belong to
 * the workspace, and no workspace switch is offered — and a site switches it
 * off through its ordinary deny-list. Every half asks the site's plugin set
 * about `FORMS_PLUGIN_ID`, never this package: the submit route refuses, the
 * contract check refuses to publish a form or a page carrying one, and the
 * published page stops drawing the element, on the server as on the client.
 *
 * On is not the same as loaded. `requiredSitePlugins` narrows the pre-render
 * set by each node's `pluginId`, so a page with no form on it does not wait
 * for this bundle — which is the saving the move buys, since every page used
 * to carry the form element inside `mui`.
 */
export function registerFormsPlugin(): void {
  // The canvas half only. The console registers the console half through its
  // own `console` surface, and a published page must never load console code
  // (AGL-3116): this runs on every page that places one of these elements.
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
