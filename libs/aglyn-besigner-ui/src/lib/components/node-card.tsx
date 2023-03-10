/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import {
  Card,
  CardProps,
  ListItemAvatar,
  ListItemText,
  Stack,
  styled,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef } from 'react'

const StyledCard = styled(Card)(({ theme }) => ({
  height: '100%',
  minHeight: 100,
  cursor: 'grab',
}))

export type NodeCardItemData =
  | Aglyn.PresetSchema<any>
  | Aglyn.ComponentSchema<any>

export interface NodeCardProps extends CardProps {
  node: NodeCardItemData
}

export const NodeCard = observer(
  forwardRef<any, NodeCardProps>((props, ref) => {
    const { node, ...rest } = props
    const label =
      node?.['label'] ||
      node?.displayName ||
      Aglyn.components.getLabel(node?.$id) ||
      node?.$id

    return (
      <StyledCard ref={ref} variant="outlined" {...rest}>
        <Stack
          height={1}
          minHeight={100}
          alignItems="center"
          justifyContent="space-evenly"
          textAlign="center"
          p={0.25}
          spacing={0.5}
        >
          <ListItemAvatar
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MdiIcon
              {...node?.icon}
              sx={{ fontSize: '2rem' }}
              color="inherit"
              path={node?.icon?.path || ICON_VARIANT_ELEMENT.path}
            />
          </ListItemAvatar>
          <div>
            <ListItemText
              primaryTypographyProps={{
                fontWeight: 'fontWeightMedium',
                lineHeight: 'normal',
                fontSize: 'subtitle2.fontSize',
              }}
            >
              {label}
            </ListItemText>
          </div>
        </Stack>
      </StyledCard>
    )
  }),
)
NodeCard.displayName = 'NodeCard'

export default NodeCard
