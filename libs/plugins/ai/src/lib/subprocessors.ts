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

import type { PluginSubprocessorDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'
import { AI_CATALOG_PROVIDERS } from './providers/catalog'
import { listAiProviders } from './providers/registry'

/**
 * The plugin's SUBPROCESSORS (AGL-2984): one declaration for every
 * registered provider whose catalog entry carries a subprocessor row, at
 * the host that provider reports. Named under `subprocessors` in
 * `plugins.config.json`: the manifest generator calls it and writes the
 * result into the console's subprocessors manifest as data, and the
 * subprocessor inventory folds that in through core's
 * `foldPluginSubprocessors`.
 *
 * Provider-generic by construction. The wording is the catalog's; the host
 * and the credential's name are the adapter's; this module names no
 * vendor. A provider whose endpoint an operator names carries no row in the
 * catalog, so it contributes nothing here.
 */

/** Stands for the provider's `apiKeyEnv` in the catalog wording. */
const API_KEY_ENV_PLACEHOLDER = '{apiKeyEnv}'

export function aiSubprocessors(): PluginSubprocessorDeclaration[] {
  const declarations: PluginSubprocessorDeclaration[] = []
  for (const provider of listAiProviders()) {
    const wording = AI_CATALOG_PROVIDERS.find((entry) => entry.id === provider.id)?.subprocessor
    if (!wording) continue
    const fill = (text: string) => text.replaceAll(API_KEY_ENV_PLACEHOLDER, provider.apiKeyEnv)
    declarations.push({
      host: provider.endpointHost,
      entity: fill(wording.entity),
      region: fill(wording.region),
      purpose: fill(wording.purpose),
      publishedOn: fill(wording.publishedOn),
      reason: fill(wording.reason),
      dataReceived: fill(wording.dataReceived),
    })
  }
  return declarations
}
