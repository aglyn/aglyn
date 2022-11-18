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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import AccordionListComponent, {
  AccordionListProps,
} from '@aglyn/besigner-feature-app/components/accordion-list.component'
import useLeafDrag from '@aglyn/besigner-feature-app/hooks/use-leaf-drag'
import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import { CardListItem, CardListItemProps } from '@aglyn/shared-ui-jsx'
import { MdiIcon, MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Box, Grid } from '@mui/material'
import { observer } from 'mobx-react-lite'
import { MutableRefObject, useMemo } from 'react'

export type ComponentGridItemData =
  | Aglyn.PresetSchema<any>
  | Aglyn.NodeSchema<any>
  | Aglyn.ComponentSchema
export type ComponentGridGroupItemData = {
  $id: string
  order: number
  icon: MdiIconProps
  label: string
  items: ComponentGridItemData[]
}
export type ComponentGridItemProps = Partial<CardListItemProps> & {
  item: ComponentGridGroupItemData
}
function ComponentGridItemRaw(
  props: ComponentGridItemProps,
  ref: MutableRefObject<any>,
) {
  const { item, ...rest } = props
  const isPreset = item?.type === Aglyn.NodeType.PRESET
  const label =
    item?.label ||
    item?.displayName ||
    Aglyn.components.getComponentLabel(item?.$id) ||
    item?.$id

  console.log('item', item)

  const [, dragHandle] = useLeafDrag(
    isPreset ? item : item,
    Besigner.DragType.PRESET,
  )

  console.log('ComponentGridItem', label, item?.$id, item)

  return (
    <CardListItem
      ref={ref}
      ContentBoxProps={{
        ref: dragHandle,
      }}
      item={item}
      label={label}
      {...rest}
    >
      {!item?.icon?.path && item?.icon ? (
        (item?.icon as any)
      ) : (
        <MdiIcon
          color="tertiary"
          {...item?.icon}
          path={item?.icon?.path || ICON_VARIANT_ELEMENT.path}
          sx={mergeSxProps(
            {
              fontSize: { xs: `5ch`, sm: `4ch` },
              padding: `0.15ch`,
              color: 'tertiary.main',
              overflow: 'visible',
            },
            item?.icon?.sx,
          )}
        />
      )}
    </CardListItem>
  )
}
ComponentGridItemRaw.displayName = 'ComponentGridItem'

const ComponentGridItem = observer<ComponentGridItemProps, any>(
  ComponentGridItemRaw,
  { forwardRef: true },
)

interface ComponentAccordionListProp
  extends AccordionListProps<ComponentGridGroupItemData> {}

function ComponentAccordionListRaw(props: ComponentAccordionListProp) {
  const { ...rest } = props
  const presets = Aglyn.presets.state.byId
  const schemas = Aglyn.components.schemas
  const allItems = [
    ...Object.values(presets || {}),
    ...Object.values(schemas || {}),
  ]

  const items = useMemo<ComponentGridGroupItemData[]>(() => {
    const grouped = allItems.reduce(
      (acc, item) => {
        const category = item?.category
        if (!category) {
          ;(acc[Aglyn.ComponentCategory.UNCATEGORIZED] ??= []).push(item)
        } else {
          ;(acc[category] ??= []).push(item)
        }
        return acc
      },
      { All: allItems },
    )

    return Object.entries(grouped)
      .sort(([aId], [bId]) => {
        switch (true) {
          case aId === 'All' && bId === 'Uncategorized':
            return 1
          case aId === 'Uncategorized' && bId === 'All':
            return -1
          case aId === 'All':
          case aId === 'Uncategorized':
            return 1
          case bId === 'All':
          case bId === 'Uncategorized':
            return -1
          default:
            return aId.localeCompare(bId)
        }
      })
      .map(
        ([groupId, group]): ComponentGridGroupItemData => ({
          $id: groupId,
          label: groupId,
          icon: {
            path: ICON_VARIANT_ELEMENT.path,
          },
          items: group,
          order: 0,
        }),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, allItems)

  return (
    <AccordionListComponent
      unique
      items={items}
      getItemId={(item) => item?.$id}
      AccordionSummaryProps={{ dense: true }}
      SummaryContentComponent={({ item }) => <>{item?.label}</>}
      DetailsContentComponent={({ id, isOpen, item, openItems, ...rest }) => (
        <Box {...rest}>
          <Grid container spacing={2}>
            {item?.items?.map((i, index) => (
              <Grid key={i?.$id ?? index} xs={6} item>
                <ComponentGridItem item={i} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    />
  )
}

ComponentAccordionListRaw.displayName = 'ComponentAccordionList'

export const ComponentAccordionList = observer<ComponentAccordionListProp>(
  ComponentAccordionListRaw,
)
export default ComponentAccordionList
