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

import type * as Aglyn from '@aglyn/aglyn'
import {
  components,
  defineUiFeatureBundle,
  plugins,
} from '@aglyn/aglyn'
import { mdiCalculatorVariantOutline } from './constants/icons'
import * as FunctionScope from './components/function-scope'
import * as FunctionWidget from './components/function-widget'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * Calculators (AGL-3387, AGL-3394): the elements that put a site function on
 * a page, published from the Aglyn org as a signed marketplace plugin.
 *
 * - **Function Widget** draws a whole calculator itself.
 * - **Calculator**, **Calculator Input**, **Calculator Result** and **Show
 *   When** let an author lay one out.
 * - **Calculator Document** and **Calculator Save Button** turn what it
 *   works out into a receipt, an invoice or a quote the visitor keeps.
 *
 * Every id sits in the plugin's namespace, `aglyn.calculator.<role>`, which
 * the loaders hold it to (AGL-3390). The functions they run come from core:
 * compose attaches a function's definition to a Calculator because the
 * manifest's `functionBindings` names its `functionName` prop (AGL-3393).
 */
export const CALCULATOR_BUNDLE: Aglyn.FeatureBundleEntry[] = [
  {
    component: FunctionWidget.default,
    schema: FunctionWidget.schema,
    presets: FunctionWidget.presets,
  },
  {
    component: FunctionScope.default,
    schema: FunctionScope.schema,
    presets: FunctionScope.presets,
  },
  {
    component: FunctionScope.FunctionInput,
    schema: FunctionScope.functionInputSchema,
    presets: FunctionScope.functionInputPresets,
  },
  {
    component: FunctionScope.FunctionOutput,
    schema: FunctionScope.functionOutputSchema,
    presets: FunctionScope.functionOutputPresets,
  },
  {
    component: FunctionScope.FunctionShow,
    schema: FunctionScope.functionShowSchema,
    presets: FunctionScope.functionShowPresets,
  },
  {
    component: FunctionScope.FunctionDocument,
    schema: FunctionScope.functionDocumentSchema,
    presets: FunctionScope.functionDocumentPresets,
  },
  {
    component: FunctionScope.FunctionSave,
    schema: FunctionScope.functionSaveSchema,
    presets: FunctionScope.functionSavePresets,
  },
]

export function registerCalculatorPlugin(): void {
  // Runs wherever a page places one of these elements, and in the Besigner
  // of a site that has the plugin (AGL-3116, AGL-3391).
  if (plugins.getDependency(BUNDLE_ID)) return
  plugins.addDependency(
    defineUiFeatureBundle(
      {
        bundleId: BUNDLE_ID,
        displayName: 'Calculators',
        description: 'Calculators, and the receipts, invoices and quotes they save',
        icon: { path: mdiCalculatorVariantOutline.path },
        components: CALCULATOR_BUNDLE,
      },
      components,
    ),
  )
}
