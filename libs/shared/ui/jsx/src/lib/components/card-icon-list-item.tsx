/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {generateComponentClassKeys, styled} from '@aglyn/shared-feature-themes'
import Card, {CardProps as MuiCardProps} from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import Typography from '@mui/material/Typography'
import clsx from 'clsx'
import {forwardRef, MouseEvent, ReactNode, useCallback} from 'react'
import {GridListItemData} from './grid-list'


const cardClasses = generateComponentClassKeys('AglynCardIconListItem', ['actionArea', 'selected'])

const StyledCard = styled(Card, {
  name: 'Card',
  slot: 'Root',
})(({theme}) => ({
  [`&.${cardClasses.selected}`]: {
    [`& .${cardClasses.actionArea}`]: {
      // backgroundColor: theme.palette.action.selected,
      backgroundColor: theme.palette.secondary.main,
      color: theme.palette.secondary.contrastText,
      // backgroundColor: emphasize(theme.palette.action.selected, 0.12),
      // color: theme.palette.getContrastText(emphasize(theme.palette.action.selected, 0.12))
    },
  },
}))

const StyledActionArea = styled(CardActionArea, {
  name: 'ActionArea',
})({
  height: 0,
  position: 'relative',
  paddingTop: `${(3 / 4) * 100}%`, // 16:9
})

const StyledWrapper = styled('div', {
  name: 'Wrapper',
})({
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
})

const StyledContent = styled('div', {
  name: 'Content',
})(({theme}) => ({
  width: '100%',
  height: '100%',
  display: 'flex',
  textAlign: 'center',
  flexDirection: 'column',
  justifyContent: 'space-evenly',
  padding: theme.spacing(0.5),
}))

export interface CardIconListItemProps extends Partial<MuiCardProps> {
  item: GridListItemData
  preview: ReactNode
  label?: ReactNode
  selected?: boolean
  onActionClick?: {
    bivarianceHack<T>(event: MouseEvent<T>, selection: unknown): void
  }['bivarianceHack']
}

export const CardIconListItem = forwardRef<any, CardIconListItemProps>(function RefRenderFn(
  props,
  ref,
) {
  const {className, selected, item, label, onActionClick, preview, ...rest} = props
  const isSelected = Boolean(selected)
  const handleClick = useCallback(
    (e) => {
      onActionClick && onActionClick(e, item)
    },
    [item, onActionClick],
  )
  return (
    <StyledCard
      ref={ref}
      className={clsx(
        {
          [cardClasses.selected]: isSelected,
        },
        className,
      )}
      {...rest}
    >
      <StyledActionArea
        disabled={isSelected}
        onClick={handleClick}
        className={cardClasses.actionArea}
      >
        <StyledWrapper>
          <StyledContent>
            <span>{preview}</span>
            {label && (
              <Typography
                component="span"
                display="block"
                variant="subtitle2"
                sx={{
                  lineHeight: 1.43,
                  fontSize: (theme) => theme.typography.pxToRem(10),
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </Typography>
            )}
          </StyledContent>
        </StyledWrapper>
      </StyledActionArea>
    </StyledCard>
  )
})

CardIconListItem.displayName = 'CardIconListItem'
CardIconListItem.defaultProps = {}

export default CardIconListItem
