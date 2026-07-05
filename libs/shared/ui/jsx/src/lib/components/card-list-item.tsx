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

import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import {
  Box,
  Card as MuiCard,
  type CardActionAreaProps as MuiCardActionAreaProps,
  type CardProps as MuiCardProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import clsx from 'clsx'
import type { ComponentProps } from 'react'
import { forwardRef } from 'react'
import ChildrenFunctionProp from './children-function-prop'
import type { GridListItemData } from './grid-list'

const cardClasses = generateComponentClassKeys('CardListItem', [
  'actionArea',
  'selected',
  'aspectContainer',
  'wrapper',
  'content',
  'label',
])

const CardBox = styled('div')({})

const Card = styled(MuiCard)(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
  [`&.${cardClasses.selected}`]: {
    [`.${cardClasses.actionArea}`]: {
      backgroundColor: tv.palette.secondary.main,
      color: tv.palette.secondary.contrastText,
    },
  },
  [`.${cardClasses.aspectContainer}`]: {
    height: 0,
    position: 'relative',
    paddingTop: `${(3 / 4) * 100}%`, // 16:9
  },
  [`.${cardClasses.wrapper}`]: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
  },
  [`.${cardClasses.content}`]: {
    width: '100%',
    height: '100%',
    display: 'flex',
    textAlign: 'center',
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'space-evenly',
    padding: 0.5,
  },
  [`.${cardClasses.label}`]: {
    lineHeight: 1.43,
    fontSize: theme.typography.pxToRem(10),
    textTransform: 'uppercase',
  },
  }
})

export interface CardListItemProps
  extends Omit<Partial<MuiCardProps>, 'children'> {
  item: GridListItemData
  children?:
    | JSX.Children
    | ((props: { item: GridListItemData; selected: boolean }) => JSX.Children)
  label?: JSX.Children
  selected?: boolean
  CardActionAreaProps?: Partial<MuiCardActionAreaProps>
  WrapperBoxProps?: Partial<ComponentProps<typeof CardBox>>
  ContentBoxProps?: Partial<ComponentProps<typeof CardBox>>
  LabelTypographyProps?: Partial<TypographyProps>
}

export const CardListItem = forwardRef<any, CardListItemProps>(
  function RefRenderFn(props, ref) {
    const {
      className,
      children,
      selected,
      item,
      label,
      CardActionAreaProps,
      WrapperBoxProps,
      ContentBoxProps,
      LabelTypographyProps,
      ...rest
    } = props

    const isSelected = Boolean(selected)

    return (
      <Card
        ref={ref}
        className={clsx({ [cardClasses.selected]: isSelected }, className)}
        {...rest}
      >
        <Box
          className={clsx(
            cardClasses.aspectContainer,
            CardActionAreaProps?.className,
          )}
        >
          <Box
            {...WrapperBoxProps}
            className={clsx(cardClasses.wrapper, WrapperBoxProps?.className)}
          >
            <Box
              {...ContentBoxProps}
              className={clsx(cardClasses.content, ContentBoxProps?.className)}
            >
              <ChildrenFunctionProp
                childrenProp={children}
                args={{ item, selected: isSelected }}
              />

              {label && (
                <Typography
                  component="span"
                  variant="subtitle2"
                  {...LabelTypographyProps}
                  className={clsx(
                    cardClasses.label,
                    LabelTypographyProps?.className,
                  )}
                  sx={[{
                    display: "block"
                  }, ...(Array.isArray(LabelTypographyProps?.sx) ? LabelTypographyProps.sx : [LabelTypographyProps?.sx])]}>
                  {label}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </Card>
    );
  },
)

CardListItem.displayName = 'CardListItem'

export default CardListItem
