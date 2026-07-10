/**
 * @license
 * Copyright 2022 Aglyn LLC
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

export {
  type ActionResolution,
  type AnyObject,
  type ComponentMapper,
  type ComponentType,
  componentTypes,
  composeValidators,
  type ConditionDefinition,
  type ConditionProp,
  type ConditionProps,
  type DataType,
  dataTypes,
  // DefaultSchemaError,
  defaultSchemaValidator,
  type Field as FieldSchema,
  FieldArray,
  FieldProvider,
  Form,
  FormError,
  type FormOptions,
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type InnerWhenFunction,
  type LenghtOptions,
  type Meta,
  type NumericalityOptions,
  parseCondition,
  type PatternOptions,
  RendererContext,
  useFieldApi,
  type UseFieldApiComponentConfig,
  type UseFieldApiConfig,
  type UseFieldApiProps,
  useFormApi,
  type Validator,
  type ValidatorConfiguration,
  type ValidatorFunction,
  type ValidatorMapper,
  validatorMapper,
  type ValidatorType,
  validatorTypes,
  type WhenFunction,
} from '@data-driven-forms/react-form-renderer'

// The root ESM barrel of the renderer does not re-export WizardContext at
// runtime; the subpath entry does.
export { default as WizardContext } from '@data-driven-forms/react-form-renderer/wizard-context'

// Since v4 these types live only on the common-types entry, not the root
// barrel. `ActionMapper`, `CommonTypes` and `MessageTypes` were removed
// upstream with no replacement.
export {
  type ExtendedMapperComponent,
  type FieldAction,
  type FieldActions,
  type FieldApi,
  type FormTemplateRenderProps,
  type Input,
  type PartialValidator,
  type ResolvePropsFunction,
} from '@data-driven-forms/react-form-renderer/common-types'

// v4's `Schema<T>` derives `fields` from a ComponentMapper generic whose
// default collapses to `never[]`; our schemas are plain field objects, so
// the public type extends the legacy shape, keeping the id/name extras
// (and arbitrary keys) the v3 module augmentation used to provide.
import type { LegacySchemaType } from '@data-driven-forms/react-form-renderer/common-types/schema'
export interface FormSchema extends LegacySchemaType, Record<string, any> {
  id?: string
  name?: string
}

export {
  default as validation,
  type ValidationOptions,
} from '@data-driven-forms/react-form-renderer/validation/validation'

export {
  prepareMsg,
  memoize,
} from '@data-driven-forms/react-form-renderer/common'

// v4 no longer exports the MessageObject interface; derive it from prepareMsg.
import { prepareMsg as _prepareMsg } from '@data-driven-forms/react-form-renderer/common'
export type MessageObject = ReturnType<typeof _prepareMsg>

export { default as prepareComponentProps } from '@data-driven-forms/react-form-renderer/prepare-component-props'

export { default as getVisibleFields } from '@data-driven-forms/react-form-renderer/get-visible-fields'

export { default as getValidates } from '@data-driven-forms/react-form-renderer/get-validates'

export { default as getConditionTriggers } from '@data-driven-forms/react-form-renderer/get-condition-triggers'

export { default as Condition } from '@data-driven-forms/react-form-renderer/condition'
