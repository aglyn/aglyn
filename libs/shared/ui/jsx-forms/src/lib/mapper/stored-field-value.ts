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

import { useFormApi } from '../vendor/data-driven-forms'

/**
 * Whether a field holds a value of its own, read from the form rather than
 * from `input`: final-form hands a checkbox or a radio group `checked`, and
 * `input.value` there is the option's value, not the stored one. `false` is a
 * value someone chose; only nothing at all is unset.
 */
export function useStoredFieldHasValue(name: string): boolean {
  const formApi = useFormApi()
  const stored = formApi?.getFieldState?.(name)?.value
  return stored !== undefined && stored !== null && stored !== ''
}
