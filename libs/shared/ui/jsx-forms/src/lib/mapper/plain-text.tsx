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

/**
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0).
 */

import type { ElementType, ReactNode } from 'react'

import { Typography, type TypographyProps } from '@mui/material'

export interface PlainTextProps extends Omit<TypographyProps, 'variant'> {
  label?: ReactNode
  name?: string
  component?: ElementType
  element?: ElementType
  variant?: TypographyProps['variant']
  gutterBottom?: boolean
}

export const PlainText = ({
  label,
  name,
  component,
  element,
  variant = 'body1',
  gutterBottom = true,
  ...props
}: PlainTextProps) =>
  typeof label === 'string' ? (
    <>
      {label.split('\n').map((paragraph, index) => (
        <Typography
          key={`${index}-${name}`}
          variant={variant}
          gutterBottom={gutterBottom}
          {...props}
          {...(element && { component: element })}
        >
          {paragraph}
        </Typography>
      ))}
    </>
  ) : (
    <Typography {...props} {...(element && { component: element })}>
      {label}
    </Typography>
  )

export default PlainText
