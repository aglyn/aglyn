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
  pattern: new RegExp(`^.{${min},${max}}$`, 'mi'),
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
    size: { xs: 12, sm: 6 },
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
    size: { xs: 12, sm: 6 },
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
  helperText: 'Include the country code for numbers outside the US and Canada',
  validate: [
    {
      // Deliberately permissive: this rejects obvious nonsense so the save
      // can normalize to E.164 with confidence, and leaves the real parsing
      // to `normalizePhone` (AGL-1133). A strict E.164 pattern here would
      // reject "(512) 555-0123", which is how people actually type a phone
      // number, and a field that refuses correct input is worse than an
      // unnormalized one.
      type: validatorTypes.PATTERN,
      pattern: /^\+?[\d][\d\s().-]{8,}$/,
      message: 'Enter a valid phone number, e.g. (512) 555-0123',
    },
  ],
}

/**
 * Postal address (AGL-1133).
 *
 * Dotted names so the form submits ONE nested `address` object matching
 * `AglynPostalAddress`, rather than six loose columns that each caller would
 * have to reassemble — reassembling is where variants come from.
 */
export const FIELD_SCHEMA_ADDRESS_LINE1: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'address.line1',
  label: 'Address',
  type: 'text',
}

export const FIELD_SCHEMA_ADDRESS_LINE2: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'address.line2',
  label: 'Apartment, suite, etc.',
  type: 'text',
}

export const FIELD_SCHEMA_ADDRESS_CITY: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'address.city',
  label: 'City',
  type: 'text',
}

export const FIELD_SCHEMA_ADDRESS_STATE: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  // `state`, not `region` — Stripe's customer address and the commerce
  // plugin's OrderAddress both call it `state`, and a third spelling in the
  // one type meant to end variants would be self-defeating.
  name: 'address.state',
  label: 'State / Province',
  type: 'text',
}

export const FIELD_SCHEMA_ADDRESS_POSTAL_CODE: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'address.postalCode',
  label: 'Postal code',
  type: 'text',
}

export const FIELD_SCHEMA_ADDRESS_COUNTRY: FieldSchema = {
  component: componentTypes.TEXT_FIELD,
  name: 'address.country',
  label: 'Country',
  type: 'text',
  helperText: 'Two-letter code, e.g. US',
  validate: [
    {
      // ISO-3166-1 alpha-2 because Stripe Tax cannot compute anything from a
      // typed country name. Enforced here so the field says so, and again in
      // `normalizeAddress` so an API caller cannot bypass it.
      type: validatorTypes.PATTERN,
      pattern: /^[A-Za-z]{2}$/,
      message: 'Use the two-letter country code, e.g. US',
    },
  ],
}
