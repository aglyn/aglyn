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

import type { FormFieldDecl } from '@aglyn/aglyn'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * What the forms plugin hands a widget that reads ONE form's submissions.
 *
 * The forms plugin owns the form and the page it is read on; it does not own
 * the reader. Reading submissions — the paged, ordered walk, the read marks,
 * the replies, the attribution — is what a plugin like the Inbox is for, and
 * this zone is where one draws it, scoped to this form, without the forms
 * plugin importing it.
 */
export interface FormSubmissionsZoneProps {
  hostId: string
  formId: string
}

export const FORM_SUBMISSIONS_ZONE =
  definePluginZone<FormSubmissionsZoneProps>('formSubmissions')

/**
 * Where each of a form's fields saves on the person, decided by whichever
 * plugin keeps people.
 *
 * A form declares its fields; what a contact's fields are is another plugin's
 * to know. This zone sits on the form's page beside routing and the consent
 * field and hands that plugin the published declaration. A widget here decides
 * what the declaration should become and calls `saveFields`; the page does the
 * write, because the form document is this plugin's.
 */
export interface FormContactFieldsZoneProps {
  hostId: string
  formId: string
  /** The PUBLISHED declaration, as stored on the form document. */
  fields: readonly FormFieldDecl[]
  /** True while the form document is still being read. */
  loading?: boolean
  /** Writes the declaration back onto the form document. */
  saveFields: (fields: FormFieldDecl[]) => Promise<void>
}

export const FORM_CONTACT_FIELDS_ZONE =
  definePluginZone<FormContactFieldsZoneProps>('formContactFields')
