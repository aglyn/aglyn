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

/**
 * Which plugin's switch decides a submission to this plugin's door, and what
 * the door says when that switch is off (AGL-3029). The door's own words:
 * read by the door (`server/form-submit.ts`) and nothing else.
 */

import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * What `/api/forms/submit` answers a submission to a site that switched Forms
 * off (AGL-3029). A visitor reads it, so it names no plugin and no setting.
 */
export const FORMS_OFF_FOR_SITE_REFUSAL = 'This site is not accepting form submissions'

/**
 * The marketing plugin's id, as the door names the plugin whose switch judges
 * a popup's capture. This plugin holds no import of it; the catalog is where
 * the string is defined.
 */
const MARKETING_PLUGIN_ID = 'marketing'

/**
 * The plugin whose door a submission to `/api/forms/submit` came through
 * (AGL-3029) — the plugin that must run on the site for it to be accepted.
 *
 * The endpoint is shared. A form element posts to it, and so does a Marketing
 * popup's email capture, which is a Marketing element rather than a form: a
 * site that switched Forms off and still shows its popup must not silently
 * lose every address the popup collects. The popup names its door in the
 * body; everything else is a form's.
 *
 * A body that names a form ENTITY or a dataset binding is a form's, whatever
 * door it claims. Those are what a form element sends and a popup never does,
 * so the popup door cannot be used to file rows under a form, or into a
 * dataset, on a site that switched Forms off.
 */
export function formSubmissionDoorPlugin(body: Record<string, unknown> | null | undefined): string {
  const namesFormData =
    Boolean(String(body?.['formId'] ?? '').trim()) || Boolean(body?.['datasetBinding'])
  return body?.['door'] === 'popup' && !namesFormData ? MARKETING_PLUGIN_ID : BUNDLE_ID
}
