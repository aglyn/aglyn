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

/** One form as its own screen (AGL-3622): what a phone pushes from the list or a link. */

import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { FormDetail } from './form-detail'

export default function FormScreen({ params, context }: MobileScreenProps) {
  return <FormDetail context={context} formId={params['formId'] || null} />
}
