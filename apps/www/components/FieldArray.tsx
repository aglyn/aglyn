import React from 'react'
import { Components } from '../lib/input-fields'
import { FT, lbl } from '@aglyn/core'
import FormFields, { Props as FormFieldsProps } from './FormFields'
import SvgPathIcon from '@aglyn/common/components/SvgPathIcon'

function FieldArrayItem(props: ArrayItemProps) {
  const { value, ...rest } = props
  const [index, property] = value
  const fields = [
    {
      GridItemProps: { xs: 1 },
      component: Components.Elements.byKey.TextField,
      name: 'index',
      label: 'Index',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      disabled: true,
      size: 'small',
      InputLabelProps: { shrink: true },
      value: String(index)
    },
    {
      GridItemProps: { xs: 3 },
      component: Components.Elements.byKey.TextField,
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
    <FormFields items={fields} {...rest} />
  )
}
FieldArrayItem.displayName = 'FieldArrayItem'
interface ArrayItemProps extends FormFieldsProps {
  value: [index: number, schema: { type: symbol }]
}

const emptyArrayItem = (index: number) => {
  return ({
    GridItemProps: { xs: 12 },
    component: FieldArrayItem,
    value: [index, { type: FT.Tag.sorted }],
  })
}

function FieldArray(props: Props) {
  const { value, ...rest } = props
  const [fields, setFields] = React.useState<any>(
    Array.from(new Array(3)).map((_, index) => emptyArrayItem(index))
  )
  const handleAddItem = React.useCallback((e) => {
    setFields(prev => [...prev, emptyArrayItem(prev.length)])
  }, [])

  console.log(fields)
  return (
    <FormFields
      items={fields.concat([
        {
          GridItemProps: { xs: 12 },
          component: Components.Elements.byKey.Button,
          variant: 'outlined',
          startIcon: <SvgPathIcon iconId="plus" />,
          children: 'Add',
          onClick: (e) => {
            console.log('click')

            handleAddItem(e)
          },
        }
      ])}
      {...rest}
    />
  )
}

FieldArray.displayName = 'FieldArray'

export interface Props extends FormFieldsProps {
  value: any
}

export default FieldArray
