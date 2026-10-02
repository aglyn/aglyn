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

// The loader's two imports come BEFORE the dispatcher's: importing the
// dispatcher runs a spec's mock of the tenant's loader, which asks this module
// for `formsOnlyServerPluginLoader` while this module is still loading.
import { createPluginLoader } from '@aglyn/aglyn/plugin-manager/plugin-loader'
import { TENANT_PLUGIN_SERVER_MANIFEST } from '../utils/plugins.server.generated'
import { POST as dispatch } from '../app/api/[...pluginApi]/route'

/**
 * `POST /api/forms/submit` AS THE TENANT SERVES IT (AGL-3080): the forms
 * plugin's door, through the tenant's plugin API dispatcher.
 *
 * The forms plugin's tenant API surface loads the way the tenant loads it —
 * its entry in the generated server manifest, activated by the plugin loader,
 * which is what marks the registration as the plugin's — and no other
 * plugin's does, because the real loader would activate every plugin's
 * surface under a spec's closed-world mocks. A spec hands the dispatcher this
 * loader in place of the tenant's:
 *
 *     jest.mock('../utils/server-plugin-loader', () => ({
 *       serverPluginLoader: jest.requireActual('./plugin-door-dispatch').formsOnlyServerPluginLoader(),
 *     }))
 *     import { POST } from './plugin-door-dispatch'
 */
export function formsOnlyServerPluginLoader() {
  return createPluginLoader(
    TENANT_PLUGIN_SERVER_MANIFEST.filter((entry) => entry.id === 'forms'),
  )
}

/** One submission, posted to the door at `/api/forms/submit`. */
export function POST(request: Request): Promise<Response> {
  return dispatch(request, { params: Promise.resolve({ pluginApi: ['forms', 'submit'] }) })
}
