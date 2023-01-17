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

import { styled } from '@aglyn/shared-ui-theme'
import { Stack, type StackProps } from '@mui/material'
import clsx from 'clsx'
import { classKeys } from '../constants'

interface LegendItemProps extends Partial<StackProps> {
  item: 'margin' | 'padding' | 'contents'
}

export const LegendItem = (props: LegendItemProps) => {
  const { item, className, ...rest } = props

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="start"
      className={clsx(
        classKeys.legendItem,
        { [classKeys[item]]: Boolean(classKeys[item]) },
        className,
      )}
      spacing={1}
      {...rest}
    >
      <div className={classKeys.legendSwatch} />
      <div className={classKeys.legendLabel}>{item}</div>
    </Stack>
  )
}

export const Legend = styled(Stack)(({ theme }) => {
  return {
    [`.${classKeys.legendSwatch}`]: {
      borderStyle: 'solid',
      borderWidth: 1,
      content: '" "',
      width: 10,
      height: 10,
    },
    [`.${classKeys.margin}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.warning.dark,
      },
    },
    [`.${classKeys.padding}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'dashed',
        borderColor: theme.palette.success.dark,
      },
    },
    [`.${classKeys.contents}`]: {
      [`.${classKeys.legendSwatch}`]: {
        borderStyle: 'solid',
        borderColor: theme.palette.info.dark,
      },
    },
    [`.${classKeys.legendLabel}`]: {
      color: theme.palette.text.secondary,
      textTransform: 'capitalize',
    },
  }
})

export default Legend
