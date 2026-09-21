# @aglyn/shared-data-forms

Ready-made field schemas and validator lists for [data-driven-forms](https://github.com/data-driven-forms/react-forms): email, password, name, phone, message and postal address fields. Install it if you render forms with `@data-driven-forms/react-form-renderer` and want these common fields predefined. Inside Aglyn the console builds its sign-in and account forms from it.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-data-forms@beta

No peer dependencies. `@data-driven-forms/react-form-renderer` is a regular dependency; the schemas use its `componentTypes` and `validatorTypes`.

## What's in it

All exports are plain objects and arrays. There is no React code here.

- Validator lists: `VALIDATOR_LIST_EMAIL`, `VALIDATOR_LIST_PASSWORD`.
- Account fields: `FIELD_SCHEMA_EMAIL`, `FIELD_SCHEMA_PASSWORD`, `FIELD_SCHEMA_PASSWORD_OLD`, `FIELD_SCHEMA_PASSWORD_CONFIRM`, `FIELD_SCHEMA_FIRST_NAME`, `FIELD_SCHEMA_LAST_NAME`, `FIELD_SCHEMA_ORGANIZATION_NAME`, `FIELD_SCHEMA_PHONE_NUMBER`.
- Text fields: `FIELD_SCHEMA_MESSAGE_SHORT`, `FIELD_SCHEMA_MESSAGE_LONG`, `FIELD_SCHEMA_DESCRIPTION_SHORT`, `FIELD_SCHEMA_DESCRIPTION_LONG`.
- Address fields: `FIELD_SCHEMA_ADDRESS_LINE1`, `FIELD_SCHEMA_ADDRESS_LINE2`, `FIELD_SCHEMA_ADDRESS_CITY`, `FIELD_SCHEMA_ADDRESS_STATE`, `FIELD_SCHEMA_ADDRESS_POSTAL_CODE`, `FIELD_SCHEMA_ADDRESS_COUNTRY`.

Entry points: `.` and `@aglyn/shared-data-forms/fields`.

## Usage

Each constant is a data-driven-forms field. Put them in a schema's `fields` array, spreading to override a property:

```ts
import {
  FIELD_SCHEMA_EMAIL,
  FIELD_SCHEMA_PASSWORD,
} from '@aglyn/shared-data-forms'

export const signInSchema = {
  fields: [
    FIELD_SCHEMA_EMAIL,
    { ...FIELD_SCHEMA_PASSWORD, label: 'Your password' },
  ],
}
```

Pass the schema to a `FormRenderer` together with a component mapper. `@aglyn/shared-ui-jsx-forms` provides a Material UI mapper.

## How it fits

A `shared` data package. It depends on `@aglyn/shared-data-regex` for the patterns its validators use. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/data/forms
