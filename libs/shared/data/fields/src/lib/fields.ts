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

import {
  REGEX_EMAIL,
  REGEX_LETTER_LOWER,
  REGEX_LETTER_UPPER,
  REGEX_NO_SPACES,
  REGEX_NUMBER,
  REGEX_SPECIAL_CHARACTER,
} from '@aglyn/shared-data-regex'
import {FieldComponentTypeFlag, FieldValidatorTypeFlag, type FormField} from '@aglyn/shared-ui-jsx'


export const FIELD_SCHEMA_EMAIL: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'email',
  label: 'Email',
  placeholder: 'Work email',
  type: 'text',
  isRequired: true,
  validate: [
    {
      type: FieldValidatorTypeFlag.REQUIRED,
      message: 'Email address is required',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_EMAIL,
      message: 'Enter a valid email (name@domain.com)',
    },
  ],
}

export const FIELD_SCHEMA_PASSWORD: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'Passwd',
  label: 'Password',
  type: 'password',
  isRequired: true,
  validate: [
    {
      type: FieldValidatorTypeFlag.REQUIRED,
      message: 'Password is required',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: /^.{6,30}$/,
      message: 'Length must between 6–30 characters',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_LETTER_UPPER,
      message: 'Must contain at least 1 uppercase letter',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_LETTER_LOWER,
      message: 'Must contain at least 1 lowercase letter',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_NUMBER,
      message: 'Must contain at least 1 number',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_SPECIAL_CHARACTER,
      message: 'Must contain a special character [/!@$]',
    },
    {
      type: FieldValidatorTypeFlag.PATTERN,
      pattern: REGEX_NO_SPACES,
      message: 'Password can not have spaces',
    },
  ],
}

export const FIELD_SCHEMA_PASSWORD_CONFIRM: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'ConfirmPasswd',
  label: 'Confirm',
  type: 'password',
  required: true,
  validate: [
    {
      type: FieldValidatorTypeFlag.REQUIRED,
      message: 'Confirm your password.',
    },
    (value, values) => {
      return values['Passwd'] !== value
        ? 'Those passwords didn\'t match. Try again.'
        : undefined
    },
  ],
}

export const FIELD_SCHEMA_FIRST_NAME: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'firstName',
  label: 'First name',
  type: 'text',
  FormFieldGridProps: {
    xs: 12, sm: 6,
  },
  isRequired: true,
  validate: [
    {type: FieldValidatorTypeFlag.REQUIRED, message: 'Please enter a first name'},
    {type: FieldValidatorTypeFlag.MIN_LENGTH, threshold: 2, message: 'Please enter a longer first name'},
  ],
}

export const FIELD_SCHEMA_LAST_NAME: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'lastName',
  label: 'Last name',
  type: 'text',
  FormFieldGridProps: {
    xs: 12, sm: 6,
  },
  isRequired: true,
  validate: [
    {type: FieldValidatorTypeFlag.REQUIRED, message: 'Provide your last name'},
    {type: FieldValidatorTypeFlag.MIN_LENGTH, threshold: 1, message: 'Please enter a longer last name'},
  ],
}

export const FIELD_SCHEMA_ORGANIZATION_NAME: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'organization',
  label: 'Organization name',
  type: 'text',
  isRequired: true,
  validate: [
    {
      type: FieldValidatorTypeFlag.REQUIRED,
      message: 'Provide your organization/company name',
    },
  ],
}

export const FIELD_SCHEMA_COMMENTS_SHORT: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'comments',
  label: 'Comments',
  type: 'text',
}

export const FIELD_SCHEMA_COMMENTS_LONG: FormField = {
  component: FieldComponentTypeFlag.TEXTAREA,
  name: 'comments',
  label: 'Comments',
  type: 'text',
  rows: 2,
}

export const FIELD_SCHEMA_DESCRIPTION_SHORT: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'description',
  label: 'Description',
  type: 'text',
}

export const FIELD_SCHEMA_DESCRIPTION_LONG: FormField = {
  component: FieldComponentTypeFlag.TEXTAREA,
  name: 'description',
  label: 'Description',
  type: 'text',
  rows: 2,
}

export const FIELD_SCHEMA_PHONE_NUMBER: FormField = {
  component: FieldComponentTypeFlag.TEXT_FIELD,
  name: 'phoneNumber',
  label: 'Phone number',
  type: 'text',
}
