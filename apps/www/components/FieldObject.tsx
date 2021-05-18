import React from 'react'
import { Components, FieldPreset } from '../lib/input-fields'
import { FT, lbl } from '@aglyn/core'
import FormFields, { Props as FormFieldsProps } from './FormFields'
import SvgPathIcon from '@aglyn/common/components/SvgPathIcon'

function FieldObjectProperty(props: ObjectPropertyProps) {
  const { value, ...rest } = props
  const [key, property] = value
  const fields = [
    {
      GridItemProps: { xs: 2 },
      component: Components.Elements.byKey.TextField,
      name: 'key',
      label: 'Key',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      size: 'small',
      InputLabelProps: { shrink: true },
      value: String(key)
    },
    {
      GridItemProps: { xs: 3 },
      component: Components.Elements.byKey.SelectField,
      name: 'kind',
      label: 'Kind',
      placeholder: 'Data kind',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      size: 'small',
      value: property.type,
      items: FT.Tag.all.map((sym: any) => ({
        value: sym,
        children: lbl[sym],
      } as any))
    },
  ]
  return (
    <FormFields items={fields as any} {...rest} />
  )
}
FieldObjectProperty.displayName = 'FieldObjectProperty'
interface ObjectPropertyProps extends Omit<FormFieldsProps, 'items'> {
  value: [key: string | number, property: { type: symbol }]
}

// const emptyObjectProperty = (key: string | number) => {
//   return ({
//     GridItemProps: { xs: 12 },
//     component: FieldObjectProperty,
//     value: [key, PropertyModel.create()],
//   })
// }

function FieldObject(props: Props) {
  const { value, onChange, ...rest } = props

  const handleAddProperty = React.useCallback((e) => {
    // setFields(prev => [...prev, emptyObjectProperty(prev.length)])
  }, [])

  const nameField = FieldPreset.Named.byKey.name
  const addButtonField = {
    GridItemProps: { xs: 12 },
    component: Components.Elements.byKey.Button,
    variant: 'outlined',
    startIcon: <SvgPathIcon iconId="plus" />,
    children: 'Add',
    onClick: (e) => {
      console.log('click')
      handleAddProperty(e)
    },
  }

  return (
    <FormFields
      items={[
        nameField,
        Object.keys(value?.get('items')).map(k => value.get(k)),
        addButtonField
      ].filter(v => Boolean(v)) as any}
      {...rest}
    />
  )
}

FieldObject.displayName = 'FieldObject'

export interface Props extends Omit<FormFieldsProps, 'items'> {
  value: any
}

export default FieldObject
