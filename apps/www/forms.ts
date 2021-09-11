/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { _hasKey, _isStrT } from '@aglyn/shared/util/guards'
import { len } from '@aglyn/shared/util/tools'
import { Schema as DdfSchema } from '@data-driven-forms/react-form-renderer'
import validation from '@data-driven-forms/react-form-renderer/validation'
import { ValidationOptions } from '@data-driven-forms/react-form-renderer/validation/validation'
import validatorTypes from '@data-driven-forms/react-form-renderer/validator-types'
import md5 from 'md5'


export const validateRegex = (value: string, regex) => (new RegExp(regex)).test(value)
export const fieldHasError = (field: Fields.FieldT) => Boolean(field.status & Fields.FieldStatus.ERROR)
export const fieldHasValid = (field: Fields.FieldT) => Boolean(field.status & Fields.FieldStatus.VALID)
export const formIsValid = (fields: Fields.FieldGroup) => Object.values(fields).some(field => fieldHasValid(field))
export const validateField = (field: Fields.FieldT, value: any): Fields.FieldT => {
  const current = {...field, value, errorMessage: null}

  if (current.status === Fields.FieldStatus.NONE) {
    current.status |= Fields.FieldStatus.TOUCHED
  } else if (current.status & Fields.FieldStatus.VALID) {
    current.status ^= Fields.FieldStatus.VALID
  } else if (current.status & Fields.FieldStatus.ERROR) {
    current.status ^= Fields.FieldStatus.ERROR
  }

  let isValid = true
  const validators = current.validators ?? []

  if (len(validators)) {
    let i = 0
    while (i < len(validators)) {
      let {regex, errorMessage} = validators[i++]
      if (!validateRegex(value, regex)) {
        current.errorMessage = errorMessage
        isValid = false
        break
      }
    }
  } else if (current.required) {
    isValid = Boolean(value)
    current.errorMessage = 'Field is required'
  }
  current.status |= isValid ? Fields.FieldStatus.VALID : Fields.FieldStatus.ERROR

  return current
}


export namespace Fields {

  export enum FieldStatus {
    NONE,
    TOUCHED = 1,
    ERROR = 1 << 1,
    VALID = 1 << 2,
  }

  export type Option = {
    value: string,
    label: string
  }
  export type GetOptions = (...args: any[]) => Option[] | Promise<Option[]>

  export type Validator = {
    regex: RegExp
    errorMessage: string
  }

  export type FieldT = {
    id: string
    defaultValue?: any
    value?: any
    status?: FieldStatus
    errorMessage?: string
    required?: boolean
    type?: string
    label?: string
    options?: Option[] | GetOptions
    validators?: Validator[]
  }

  export type FieldGroup = {
    [id: string]: FieldT
  }

  /*******************************
   * Field definitions
   *******************************/

  export const emailField: FieldT = {
    id: 'email',
    label: 'Email',
    type: 'text',
    status: FieldStatus.NONE,
    errorMessage: null,
    required: true,
    validators: [
      {
        regex: /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/,
        errorMessage: 'Enter a valid email',
      },
    ],
  }
  export const firstNameField: FieldT = {
    id: 'firstName',
    label: 'First Name',
    type: 'text',
    status: FieldStatus.NONE,
    errorMessage: null,
    required: true,
  }
  export const lastNameField: FieldT = {
    id: 'lastName',
    label: 'Last Name',
    type: 'text',
    status: FieldStatus.NONE,
    errorMessage: null,
    required: true,
  }
  export const passwordField: FieldT = {
    id: 'password',
    label: 'Password',
    type: 'password',
    status: FieldStatus.NONE,
    errorMessage: null,
    required: true,
    validators: [
      {
        regex: /^.{6,30}$/,
        errorMessage: 'Must contain between 6 and 30 characters',
      },
      {
        regex: /[A-Z]/,
        errorMessage: 'Must contain a uppercase letter',
      },
      {
        regex: /[a-z]/,
        errorMessage: 'Must contain a lowercase letter',
      },
      {
        regex: /\d/,
        errorMessage: 'Must contain a number',
      },
      {
        regex: /\W/,
        errorMessage: 'Must contain a special character e.g., /,!,@,$',
      },
      {
        regex: /^[^\s]*$/,
        errorMessage: 'Not allowed to contain spaces',
      },
    ],
  }
  export const nameField: FieldT = {
    id: 'name',
    label: 'Name',
    type: 'text',
    status: FieldStatus.NONE,
    errorMessage: null,
    required: true,
  }
  export const commentsField: FieldT = {
    id: 'comments',
    label: 'Comments',
    type: 'text',
    status: FieldStatus.NONE,
  }


  /*******************************
   * Form field groups
   *******************************/

  export const signUpForm: FieldGroup = {
    [firstNameField.id]: firstNameField,
    [lastNameField.id]: lastNameField,
    [emailField.id]: emailField,
    [passwordField.id]: emailField,
  }
  export const signInForm: FieldGroup = {
    [emailField.id]: emailField,
    [passwordField.id]: emailField,
  }
  export const permissionForm: FieldGroup = {
    [nameField.id]: nameField,
    [commentsField.id]: commentsField,
  }
  export const roleForm: FieldGroup = {
    [nameField.id]: nameField,
    [commentsField.id]: commentsField,
  }

}


export namespace DdfForms {
  export type Schema = DdfSchema
  export const ValidatorType = validatorTypes

  export const ContactFormSchema: Schema = {
    fields: [
      {
        component: 'text-field',
        name: 'first-name',
        label: 'First Name',
        placeholder: 'Type your first name',
        variant: 'outlined',
        validate: [
          {type: 'required', message: 'Please enter a first name'},
          {type: 'min-length', threshold: 2, message: 'Please enter a longer first name'},
        ],
        isRequired: true,
      },
      {
        component: 'text-field',
        name: 'last-name',
        label: 'Last Name',
        placeholder: 'Type your first name',
        variant: 'outlined',
        validate: [
          {type: 'min-length', threshold: 1, message: 'Please enter a longer last name'},
          {type: 'required', message: 'Please enter a last name'},
        ],
        isRequired: true,
      },
      {
        component: 'text-field',
        name: 'company',
        label: 'Company',
        isRequired: true,
        validate: [{type: 'required', message: 'Please enter a company name'}],
        placeholder: 'Type your company name',
        variant: 'outlined',
      },
      {
        component: 'text-field',
        name: 'phone',
        label: 'Phone',
        placeholder: 'Type you phone number',
        variant: 'outlined',
      },
      {
        component: 'text-field',
        name: 'email',
        label: 'Email',
        placeholder: 'Type your business email',
        variant: 'outlined',
        isRequired: true,
        validate: [
          {type: 'required', message: 'Please enter an email address'},
          {
            type: 'pattern',
            pattern: '(?:[a-z0-9!#$%&\'*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&\'*+/=?^_`{|}~-]+)*|"(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21\\x23-\\x5b\\x5d-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x21-\\x5a\\x53-\\x7f]|\\\\[\\x01-\\x09\\x0b\\x0c\\x0e-\\x7f])+)\\])',
            message: 'Please enter a valid email address',
          },
        ],
      },
      {
        component: 'textarea',
        name: 'comments',
        label: 'Comments',
        helperText: 'Type a short description of your inquiry',
        variant: 'outlined',
        rows: 4,
      },
    ],
  }

  export const formIds = {
    contact: md5('contact').toLowerCase().trim(),
  }
  const rawFormIdFromId = {
    [formIds.contact]: 'contact',
  }
  const formSchemaFromId = {
    [formIds.contact]: ContactFormSchema,
  }

  export function isValidFormId(id: unknown): id is string {
    return _isStrT(id) && _hasKey(id, rawFormIdFromId)
  }
  export function getFormSchemaFromId(id: string): Schema {
    return formSchemaFromId[id]
  }
  export function checkRequiredValues(schema: Schema, options: ValidationOptions) {
    return validation(schema, options)
  }


}
