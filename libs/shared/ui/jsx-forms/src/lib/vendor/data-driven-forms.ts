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
  type ActionMapper,
  type ActionResolution,
  type AnyObject,
  type CommonTypes,
  type ComponentMapper,
  type ComponentType,
  componentTypes,
  composeValidators,
  type ConditionDefinition,
  type ConditionProp,
  type ConditionProps,
  type DataType,
  dataTypes,
  type DataTypeValidators,
  // DefaultSchemaError,
  defaultSchemaValidator,
  type ExtendedMapperComponent,
  type Field as FieldSchema,
  type FieldAction,
  type FieldActions,
  type FieldApi,
  FieldArray,
  type FieldArrayField,
  FieldProvider,
  type FieldProviderProps,
  Form,
  FormError,
  type FormOptions,
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type FormTemplateRenderProps,
  type InnerWhenFunction,
  type Input,
  type LenghtOptions,
  type MessageTypes,
  type Meta,
  type NumericalityOptions,
  parseCondition,
  type ParseCondition,
  type PartialValidator,
  type PatternOptions,
  RendererContext,
  type RendererContextValue,
  type ResolvePropsFunction,
  type Schema as FormSchema,
  type SchemaValidatorMapper,
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
  type WizardContextValue,
} from '@data-driven-forms/react-form-renderer'

// The root ESM barrel of the renderer does not re-export WizardContext at
// runtime; the subpath entry does.
export { default as WizardContext } from '@data-driven-forms/react-form-renderer/wizard-context'

declare module '@data-driven-forms/react-form-renderer' {
  interface Schema extends Record<string, any> {
    id?: string
    name?: string
  }
}

export {
  default as validation,
  type ValidationOptions,
} from '@data-driven-forms/react-form-renderer/validation/validation'

export {
  prepareMsg,
  type MessageObject,
  memoize,
} from '@data-driven-forms/react-form-renderer/common'

export { default as prepareComponentProps } from '@data-driven-forms/react-form-renderer/prepare-component-props'

export { default as getVisibleFields } from '@data-driven-forms/react-form-renderer/get-visible-fields'

export { default as getValidates } from '@data-driven-forms/react-form-renderer/get-validates'

export { default as getConditionTriggers } from '@data-driven-forms/react-form-renderer/get-condition-triggers'

export { default as Condition } from '@data-driven-forms/react-form-renderer/condition'
