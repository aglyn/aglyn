
import MuiButton from '@material-ui/core/Button'
import MuiTextField from '@material-ui/core/TextField'
import FieldSelect from '../components/FieldSelect'
import { Item as GridItemProps } from '@aglyn/common/components/GridItems'
import FieldObjectComponent from '../components/FieldObject'
import FieldArrayComponent from '../components/FieldArray'
import { NormalizedData, FT, lbl } from '@aglyn/core'

export namespace Components {
  export const Elements = {
    keys: [
      'Button',
      'TextField',
      'SelectField',
      'FieldObject',
      'FieldArray',
    ],
    byKey: {
      Button: MuiButton,
      TextField: MuiTextField,
      SelectField: FieldSelect,
      FieldObject: FieldObjectComponent,
      FieldArray: FieldArrayComponent,
    }
  }

  type TypeOfElementsByKey = typeof Elements['byKey']
  type KeyOfElementsByKey = keyof TypeOfElementsByKey
  type ValueOfKeyOfElementsByKey = TypeOfElementsByKey[KeyOfElementsByKey]
  export type ComponentProps<T extends ValueOfKeyOfElementsByKey> = Parameters<T>
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
    keys: [
      'id',
      'displayName',
      'dataType',
    ],
    byKey: {
      id: {
        GridItemProps: { xs: 12 as any },
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
        }
      },
      name: {
        GridItemProps: { xs: 12 as any },
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
        }
      },
      kind: {
        GridItemProps: { xs: 12 as any },
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

            FT.Tag.all.map((sym: any) => ({
              value: sym,
              children: lbl[sym],
            } as any))

          )
        }
      },
    }
  }

  export const createProperty: GridFieldPreset = {
    allIds: ['name', 'kind'],
    byId: {
      name: Named.byKey.name,
      type: Named.byKey.kind,
    }
  }

}
