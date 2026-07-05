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

import { DoD } from '@aglyn/shared-data-types'
import {
  mdiPlus,
} from '@aglyn/shared-data-mdi'
import {
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import { useCallback } from 'react'
import { Components, FieldPreset } from '../lib/input-fields'
import FormFields, { Props as FormFieldsProps } from './FormFields'

function FieldObjectProperty(props: ObjectPropertyProps) {
  const { value, ...rest } = props
  const [key, property] = value
  const fields = [
    {
      GridItemProps: { size: { xs: 2 } },
      component: Components.Elements.byKey.TextField,
      name: 'key',
      label: 'Key',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      size: 'small',
      InputLabelProps: { shrink: true },
      value: String(key),
    },
    {
      GridItemProps: { size: { xs: 3 } },
      component: Components.Elements.byKey.SelectField,
      name: 'kind',
      label: 'Kind',
      placeholder: 'Data kind',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      size: 'small',
      value: property.type,
      items: DoD.FT.Tag.all.map(
        (sym: any) =>
          (({
            value: sym,
            children: DoD.lbl[sym]
          }) as any),
      ),
    },
  ]
  return <FormFields items={fields as any} {...rest} />
}
FieldObjectProperty.displayName = 'FieldObjectProperty'
FieldObjectProperty.aglyn = true

interface ObjectPropertyProps extends Omit<FormFieldsProps, 'items'> {
  value: [key: string | number, property: { type: symbol }]
}

// const emptyObjectProperty = (key: string | number) => {
//   return ({
//     GridItemProps: { size: {xs: 12} },
//     component: FieldObjectProperty,
//     value: [key, PropertyModel.create()],
//   })
// }

function FieldObject(props: Props) {
  const { value, onChange, ...rest } = props

  const handleAddProperty = useCallback((e) => {
    // setFields(prev => [...prev, emptyObjectProperty(prev.length)])
  }, [])

  const nameField = FieldPreset.Named.byKey.name
  const addButtonField = {
    GridItemProps: { size: { xs: 12 } },
    component: Components.Elements.byKey.Button,
    variant: 'outlined',
    startIcon: <MdiIcon path={mdiPlus.path} />,
    children: 'Add',
    onClick: (e) => {
      handleAddProperty(e)
    },
  }

  return (
    <FormFields
      items={
        [
          nameField,
          Object.keys(value?.get('items')).map((k) => value.get(k)),
          addButtonField,
        ].filter((v) => Boolean(v)) as any
      }
      {...rest}
    />
  )
}

FieldObject.displayName = 'FieldObject'
FieldObject.aglyn = true

export interface Props extends Omit<FormFieldsProps, 'items'> {
  value: any
}

export default FieldObject
