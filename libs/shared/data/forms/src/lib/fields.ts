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

import {
  REGEX_EMAIL,
  REGEX_LETTER_LOWER,
  REGEX_LETTER_UPPER,
  REGEX_NO_SPACES,
  REGEX_NUMBER,
  REGEX_SPECIAL_CHARACTER,
} from '@aglyn/shared-data-regex'
import {
  componentTypes,
  validatorTypes,
  type Field as FieldSchema,
  type Validator,
} from '@data-driven-forms/react-form-renderer'

const VALIDATE_LENGTH_RANGE: (min: number, max: number) => Validator = (
  min: number,
  max: number,
) => ({
  type: validatorTypes.PATTERN,
  pattern: new RegExp(`/^.{${min},${max}}$/gmi`),
  message: `Length must between ${min}–${max} characters`,
})

const VALIDATE_PATTERN_RANGE_PASSWORD: Validator = {
  type: validatorTypes.PATTERN,
  pattern: /.{6,30}/,
  message: `Length must between 6–30 characters`,
}
const VALIDATE_PATTERN_EMAIL: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_EMAIL,
  message: 'Enter a valid email (name@domain.com)',
}
const VALIDATE_PATTERN_LOWERCASE_MIN_1: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_LETTER_LOWER,
  message: 'Must contain at least 1 lowercase letter',
}
const VALIDATE_PATTERN_UPPERCASE_MIN_1: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_LETTER_UPPER,
  message: 'Must contain at least 1 uppercase letter',
}
const VALIDATE_PATTERN_NUMBER_MIN_1: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_NUMBER,
  message: 'Must contain at least 1 number',
}
const VALIDATE_PATTERN_SPACE_NEVER: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_NO_SPACES,
  message: 'Password can not have spaces',
}
const VALIDATE_PATTERN_SPECIAL_MIN_1: Validator = {
  type: validatorTypes.PATTERN,
  pattern: REGEX_SPECIAL_CHARACTER,
  message: 'Must contain a special character [/!@$]',
}

export const VALIDATOR_LIST_EMAIL: Validator[] = [
  {
    type: validatorTypes.REQUIRED,
    message: 'Email address is required',
  },
  VALIDATE_PATTERN_EMAIL,
]

export const VALIDATOR_LIST_PASSWORD: FieldSchema['validate'] = [
  {
    type: validatorTypes.REQUIRED,
    message: 'Password is required',
  },
  VALIDATE_PATTERN_LOWERCASE_MIN_1,
  VALIDATE_PATTERN_UPPERCASE_MIN_1,
  VALIDATE_PATTERN_NUMBER_MIN_1,
  VALIDATE_PATTERN_SPECIAL_MIN_1,
  VALIDATE_PATTERN_SPACE_NEVER,
  VALIDATE_PATTERN_RANGE_PASSWORD,
]

export const FIELD_SCHEMA_EMAIL: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'email',
  label: 'Email',
  placeholder: 'Work email',
  type: 'text',
  isRequired: true,
  validate: [...VALIDATOR_LIST_EMAIL],
}

export const FIELD_SCHEMA_PASSWORD_OLD: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'OldPasswd',
  label: 'Old password',
  type: 'password',
  isRequired: true,
  validate: [...VALIDATOR_LIST_PASSWORD],
}

export const FIELD_SCHEMA_PASSWORD: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'Passwd',
  label: 'Password',
  type: 'password',
  isRequired: true,
  validate: [...VALIDATOR_LIST_PASSWORD],
}

export const FIELD_SCHEMA_PASSWORD_CONFIRM: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'ConfirmPasswd',
  label: 'Confirm password',
  type: 'password',
  required: true,
  validate: [
    {
      type: validatorTypes.REQUIRED,
      message: 'Confirm your password.',
    },
    (value, values) => {
      return values?.[FIELD_SCHEMA_PASSWORD.name] !== value
        ? "Those passwords didn't match. Try again."
        : undefined
    },
  ],
}

export const FIELD_SCHEMA_FIRST_NAME: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'firstName',
  label: 'First name',
  type: 'text',
  FormFieldGridProps: {
    xs: 12,
    sm: 6,
  },
  isRequired: true,
  validate: [
    { type: validatorTypes.REQUIRED, message: 'Please enter a first name' },
    {
      type: validatorTypes.MIN_LENGTH,
      threshold: 2,
      message: 'Please enter a longer first name',
    },
  ],
}

export const FIELD_SCHEMA_LAST_NAME: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'lastName',
  label: 'Last name',
  type: 'text',
  FormFieldGridProps: {
    xs: 12,
    sm: 6,
  },
  isRequired: true,
  validate: [
    { type: validatorTypes.REQUIRED, message: 'Provide your last name' },
    {
      type: validatorTypes.MIN_LENGTH,
      threshold: 1,
      message: 'Please enter a longer last name',
    },
  ],
}

export const FIELD_SCHEMA_ORGANIZATION_NAME: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'organization',
  label: 'Organization name',
  type: 'text',
  isRequired: true,
  validate: [
    {
      type: validatorTypes.REQUIRED,
      message: 'Provide your organization/company name',
    },
  ],
}

export const FIELD_SCHEMA_MESSAGE_SHORT: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'message',
  label: 'Additional details',
  type: 'text',
}

export const FIELD_SCHEMA_MESSAGE_LONG: FieldSchema = {
  component: componentTypes.TEXTAREA,
  name: 'message',
  label: 'Additional details',
  type: 'text',
  rows: 2,
}

export const FIELD_SCHEMA_DESCRIPTION_SHORT: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'description',
  label: 'Description',
  type: 'text',
}

export const FIELD_SCHEMA_DESCRIPTION_LONG: FieldSchema = {
  component: componentTypes.TEXTAREA,
  name: 'description',
  label: 'Description',
  type: 'text',
  rows: 2,
}

export const FIELD_SCHEMA_PHONE_NUMBER: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'phoneNumber',
  label: 'Phone number',
  type: 'text',
}
