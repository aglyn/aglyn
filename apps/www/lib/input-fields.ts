/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { DoD, NormalizedData } from '@aglyn/shared-data-types'
import { GridListItemData as GridItemProps } from '@aglyn/shared-ui-jsx'
import MuiButton from '@mui/material/Button'
import MuiTextField from '@mui/material/TextField'
import FieldArrayComponent from '../components/FieldArray'
import FieldObjectComponent from '../components/FieldObject'
import FieldSelect from '../components/FieldSelect'

export namespace Components {
  export const Elements = {
    keys: ['Button', 'TextField', 'SelectField', 'FieldObject', 'FieldArray'],
    byKey: {
      Button: MuiButton,
      TextField: MuiTextField,
      SelectField: FieldSelect,
      FieldObject: FieldObjectComponent,
      FieldArray: FieldArrayComponent,
    },
  }

  type TypeOfElementsByKey = (typeof Elements)['byKey']
  type KeyOfElementsByKey = keyof TypeOfElementsByKey
  type ValueOfKeyOfElementsByKey = TypeOfElementsByKey[KeyOfElementsByKey]
  export type ComponentProps<T extends ValueOfKeyOfElementsByKey> =
    Parameters<T>
  export type ElementType = ValueOfKeyOfElementsByKey
}

export interface GridField {
  GridItemProps?: Omit<GridItemProps, 'items'>
  component: Components.ElementType
  props?: Partial<Components.ComponentProps<GridField['component']>> | any
}

export type GridFieldPreset = NormalizedData<GridField>

export namespace FieldPreset {
  export const Named = {
    keys: ['id', 'displayName', 'dataType'],
    byKey: {
      id: {
        GridItemProps: { size: { xs: 12 } },
        component: Components.Elements.byKey.TextField,
        props: {
          name: 'id',
          label: 'ID',
          placeholder: 'Unique identifier',
          variant: 'outlined',
          color: 'primary',
          fullWidth: true,
          disabled: true,
          required: true,
          FormHelperTextProps: { component: 'div' },
          InputLabelProps: { shrink: true },
        },
      },
      name: {
        GridItemProps: { size: { xs: 12 } },
        component: Components.Elements.byKey.TextField,
        props: {
          name: 'name',
          label: 'Name',
          placeholder: 'Display name',
          helperText: 'Friendly name to reference',
          variant: 'outlined',
          color: 'primary',
          fullWidth: true,
          required: true,
          InputLabelProps: { shrink: true },
        },
      },
      kind: {
        GridItemProps: { size: { xs: 12 } },
        component: Components.Elements.byKey.SelectField,
        props: {
          name: 'kind',
          label: 'Kind',
          placeholder: 'Data kind',
          variant: 'outlined',
          color: 'primary',
          fullWidth: true,
          defaultValue: '',
          required: true,
          items: [{ value: '', children: 'Select one', disabled: true }].concat(
            DoD.FT.Tag.all.map(
              (sym: any) =>
                (({
                  value: sym,
                  children: DoD.lbl[sym]
                }) as any),
            ),
          ),
        },
      },
    },
  }

  export const createProperty: GridFieldPreset = {
    allIds: ['name', 'kind'],
    byId: {
      name: Named.byKey.name,
      type: Named.byKey.kind,
    },
  }
}
