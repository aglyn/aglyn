# @aglyn/shared-ui-jsx-forms

A Material UI component mapper for [data-driven-forms](https://github.com/data-driven-forms/react-forms), plus the extra field types Aglyn's editors need: color and icon pickers, CSS dimension, border and gradient editors, a breakpoint span row, a data table, and theme-scale and preset choosers. Besigner's property panels and the plugins' console forms are rendered with it. Install it if you use data-driven-forms with a current MUI version.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-ui-jsx-forms@beta

Peer dependencies: `react`, `next`, `@mui/material`, `@mui/icons-material` and `@mui/x-date-pickers`. `next` is required because the field components are loaded with `next/dynamic`. `@data-driven-forms/react-form-renderer` is a regular dependency and is re-exported, so you do not import it separately.

## What's in it

- **Component mappers.** `componentMapper` maps every `FieldComponentType` to its field. Narrower mappers cover common subsets: `simpleComponentMapper` (select, sub-form, switch, text field, textarea), `optionComponentMapper`, `dateTimeComponentMapper` and `pickerComponentMapper`. The individual entries are exported as `FIELD_MAP_*`, and the lazily loaded field components as `Field*` (`FieldTextField`, `FieldSelect`, `FieldColorPicker` and so on).
- **The mapper components.** Written against current MUI APIs: `Checkbox`, `Radio`, `Select`, `Switch`, `Slider`, `TextField`, `Textarea`, `DatePicker`, `TimePicker`, `DualListSelect`, `SubForm`, `Tabs`, `Wizard`, `PlainText`. The mapper is a port of `@data-driven-forms/mui-component-mapper` (Apache-2.0).
- **Editor field types.** `CssDimension`, `CssBorder`, `CssGradient`, `BreakpointSpan` and the data table field each persist a single string; their `seed…Draft` / `serialize…Draft` helpers are exported beside them. `ColorPickerComponent` can offer theme palette tokens through `ColorPickerTokensContext`. `IconSelectControl` picks a Material Design icon by id.
- **Enums.** `FieldComponentType`, `FieldValidatorType`, `FieldDataType`.
- **Templates and drawers.** `GridFormTemplateComponent` and `ArtifactFormTemplate` are form templates that lay fields out in a MUI grid with a submit button. `CreateArtifactDrawer` is a drawer with a name-and-description create form that accepts `extraFields`.
- **Re-exports from data-driven-forms.** `FormRenderer`, `FormSpy`, `FieldProvider`, `useFieldApi`, `useFormApi`, `componentTypes`, `validatorTypes`, `dataTypes`, `WizardContext` and the `FieldSchema`, `ComponentMapper`, `Validator` and related types.
- **Helpers.** `withGridItem`, `validationMessage`, `optionIsEqualToValue`.

## Usage

```tsx
'use client'

import {
  ArtifactFormTemplate,
  FieldComponentType,
  FormRenderer,
  simpleComponentMapper,
} from '@aglyn/shared-ui-jsx-forms'

const schema = {
  fields: [
    {
      component: FieldComponentType.TEXT_FIELD,
      name: 'displayName',
      label: 'Name',
      isRequired: true,
    },
    {
      component: FieldComponentType.SWITCH,
      name: 'enabled',
      label: 'Enabled',
    },
  ],
}

export function Example() {
  return (
    <FormRenderer
      FormTemplate={ArtifactFormTemplate}
      componentMapper={simpleComponentMapper}
      schema={schema}
      onSubmit={(values) => console.log(values)}
    />
  )
}
```

`@aglyn/shared-data-forms` has predefined schemas for common fields (email, password, address) that plug into the same `fields` array.

## How it fits

A `shared` UI package. It depends on `@aglyn/shared-ui-jsx`, `@aglyn/shared-ui-theme`, `@aglyn/shared-ui-color-picker`, `@aglyn/shared-data-enums`, `@aglyn/shared-data-mdi`, `@aglyn/shared-util-tools` and `@aglyn/shared-util-vendor`. `@aglyn/besigner-ui` and the forms, email and marketing plugins depend on it. Shared packages are generic: they import only other shared packages and hold no plugin's domain.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/ui/jsx-forms
