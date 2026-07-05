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
import { useCallback, useState } from 'react'
import { Components } from '../lib/input-fields'
import FormFields, { type Props as FormFieldsProps } from './FormFields'

function FieldArrayItem(props: ArrayItemProps) {
  const { value, ...rest } = props
  const [index, property] = value
  const fields = [
    {
      GridItemProps: { size: { xs: 1 } },
      component: Components.Elements.byKey.TextField,
      name: 'index',
      label: 'Index',
      variant: 'outlined',
      color: 'primary',
      fullWidth: true,
      disabled: true,
      size: 'small',
      InputLabelProps: { shrink: true },
      value: String(index),
    },
    {
      GridItemProps: { size: { xs: 3 } },
      component: Components.Elements.byKey.TextField,
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
  return <FormFields items={fields} {...rest} />
}
FieldArrayItem.displayName = 'FieldArrayItem'
FieldArrayItem.aglyn = true

interface ArrayItemProps extends FormFieldsProps {
  value: [index: number, schema: { type: symbol }]
}

const emptyArrayItem = (index: number) => {
  return {
    GridItemProps: {
      size: { xs: 12 },
    },
    component: FieldArrayItem,
    value: [index, { type: DoD.FT.Tag.sorted }],
  }
}

function FieldArray(props: Props) {
  const { value, ...rest } = props
  const [fields, setFields] = useState<any>(
    Array.from(new Array(3)).map((_, index) => emptyArrayItem(index)),
  )
  const handleAddItem = useCallback((e) => {
    setFields((prev) => [...prev, emptyArrayItem(prev.length)])
  }, [])

  return (
    <FormFields
      items={fields.concat([
        {
          GridItemProps: { size: { xs: 12 } },
          component: Components.Elements.byKey.Button,
          variant: 'outlined',
          startIcon: <MdiIcon path={mdiPlus.path} />,
          children: 'Add',
          onClick: (e) => {
            handleAddItem(e)
          },
        },
      ])}
      {...rest}
    />
  )
}

FieldArray.displayName = 'FieldArray'
FieldArray.aglyn = true

export interface Props extends FormFieldsProps {
  value: any
}

export default FieldArray
