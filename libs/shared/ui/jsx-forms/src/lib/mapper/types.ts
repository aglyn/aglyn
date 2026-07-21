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

import type { HelpTipContent } from '@aglyn/shared-ui-jsx'
import type { ReactNode } from 'react'

export type OptionValue = string | number | boolean | null | undefined

export interface SelectOption<T = OptionValue> {
  value: T
  label: ReactNode
  [key: string]: unknown
}

export type SelectValue<T = OptionValue> =
  | T
  | SelectOption<T>
  | (T | SelectOption<T>)[]
  | null

/**
 * Common schema-driven field props resolved through `useFieldApi`. The
 * renderer passes arbitrary extra props from the field schema, hence the
 * index signature (mirrors upstream mui-component-mapper typings).
 */
export interface BaseFieldProps {
  name: string
  label?: ReactNode
  helperText?: ReactNode
  description?: ReactNode
  isRequired?: boolean
  isDisabled?: boolean
  isReadOnly?: boolean
  validateOnMount?: boolean
  /** Contextual help tooltip rendered at the field's top-right (AGL-601). */
  help?: HelpTipContent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}
