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
  AccordionListItem,
  AccordionListProps,
} from '@aglyn/besigner-feature-app/components/accordion-list.component'
import useLeafDrag from '@aglyn/besigner-feature-app/hooks/use-leaf-drag'
import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import {
  CardListItem,
  CardListItemProps,
  useForkedRefs,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Box, Grid } from '@mui/material'
import groupBy from 'lodash-es/groupBy'
import { observer } from 'mobx-react-lite'
import { forwardRef, useMemo } from 'react'

type ComponentGridItemData = Aglyn.PresetSchema<any> | Aglyn.NodeSchema<any>
type ComponentGridGroupItemData = {
  id: string
  order: number
  labelPrimary: JSX.Node
  labelSecondary: JSX.Node
  icon: MdiIconProps
  items: ComponentGridItemData[]
}
type ComponentGridItemProps = Partial<CardListItemProps> & {
  item: ComponentGridGroupItemData
}
const ComponentGridItem = forwardRef<any, ComponentGridItemProps>(
  (props, forwardRef) => {
    const { item, ...rest } = props
    const isPreset = item?.type === Aglyn.NodeType.PRESET
    const icon = isPreset ? item?.schema?.icon : item?.icon

    const label =
      item?.label ||
      item?.displayName ||
      item?.title ||
      (isPreset
        ? item?.schema?.label
        : Aglyn.components.getComponentLabel(item?.componentId))

    const [, dragHandle, dragPreview] = useLeafDrag(
      { $id: item?.$id, node: item },
      Besigner.dnd.DragType.TEMPLATE,
    )

    !label && console.log('ComponentGridItem', label, item?.$id, item)

    const ref = useForkedRefs(forwardRef, dragHandle)

    return (
      <CardListItem
        ref={ref}
        ContentBoxProps={{
          ref: dragPreview,
        }}
        item={{ ...item, id: item?.$id }}
        label={label}
        {...rest}
      >
        {!icon?.path && icon ? (
          (icon as any)
        ) : (
          <MdiIcon
            color="tertiary"
            {...icon}
            path={icon?.path || ICON_VARIANT_ELEMENT.path}
            sx={mergeSxProps(
              {
                fontSize: { xs: `5ch`, sm: `4ch` },
                padding: `0.15ch`,
                color: 'tertiary.main',
                overflow: 'visible',
              },
              icon?.sx,
            )}
          />
        )}
      </CardListItem>
    )
  },
)
export const ComponentAccordionList = observer(
  <T extends AccordionListItem = AccordionListItem>(
    props: AccordionListProps<T>,
  ) => {
    const { ...rest } = props
    const presets = Aglyn.presets.state
    const schemas = Aglyn.components.schemas

    const items = useMemo<ComponentGridGroupItemData[]>(() => {
      const allItems = [
        ...Object.values(presets || {}),
        ...Object.values(schemas || {}),
      ]

      const grouped = groupBy(allItems, (i) => {
        return i?.category || i?.meta?.category || 'Uncategorized'
      })

      const mapped = Object.entries({ ...grouped, All: allItems })
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
        .map(([groupId, group]) => {
          return {
            id: groupId,
            labelPrimary: groupId,
            labelSecondary: 'Category',
            icon: {
              path: ICON_VARIANT_ELEMENT.path,
            },
            items: group,
            order: 0,
          }
        })

      console.log('aside panel group components', mapped)

      return mapped
    }, [presets, schemas])

    return (
      <AccordionListComponent
        unique
        items={items}
        AccordionSummaryProps={{ dense: true }}
        SummaryContentComponent={({ id, isOpen, item }) => (
          <>{item?.labelPrimary}</>
        )}
        DetailsContentComponent={(props) => {
          const { id, isOpen, item, openItems, ...rest } = props
          return (
            <Box {...rest}>
              <Grid container spacing={2}>
                {((item?.['items'] as any[]) || []).map((i, index) => (
                  <Grid key={i?.$id ?? index} xs={6} item>
                    <ComponentGridItem item={i} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )
        }}
        {...rest}
      />
    )
  },
)

ComponentAccordionList.displayName = 'ComponentAccordionList'

export default ComponentAccordionList
