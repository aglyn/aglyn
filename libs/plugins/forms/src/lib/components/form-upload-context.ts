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

import { createContext } from 'react'

/**
 * What a Form hands the File upload fields inside it (AGL-4098): the form
 * entity the files are sent for, and the pending submission key they go up
 * under, minted once per open form and on first use. `live` is false on an
 * editing surface (the canvas, Preview), where nothing is uploaded.
 *
 * Its own module, so the Form and the File upload field's lazily loaded body
 * share one context without either importing the other's code.
 */
export interface FormUploadContextValue {
  formId: string | undefined
  uploadKey: () => string
  live: boolean
}

export const FormUploadContext = createContext<FormUploadContextValue | null>(null)
