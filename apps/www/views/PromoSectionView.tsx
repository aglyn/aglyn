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

import { styled } from '@aglyn/shared/ui/themes'
import Box from '@material-ui/core/Box'
import Typography from '@material-ui/core/Typography'
import React, { ElementType, forwardRef, HTMLAttributes, ReactNode } from 'react'
import BackgroundImage from '../components/BackgroundImage'
import Link, { LinkProps } from '../components/Link'


const StyledPromoBackgroundImage = styled(BackgroundImage, {
  name: 'PromoBackgroundImage'
})(({theme}) => ({
  textAlign: 'center',
  marginTop: theme.spacing(4),
  marginBottom: theme.spacing(8),
  borderRadius: theme.shape.borderRadius,
  color: theme.palette.common.white,
  backgroundColor: theme.palette.secondary.light,
  padding: theme.spacing(4, 2),
  [theme.breakpoints.up('sm')]: {
    padding: theme.spacing(8, 4),
  },
}))

export interface PromoSectionViewProps extends HTMLAttributes<HTMLElement> {
  component?: ElementType
  backgroundUrl: string
  heading: ReactNode
  link: LinkProps
}

const PromoSectionView = forwardRef<any, PromoSectionViewProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      className: propClass,
      link,
      heading,
      backgroundUrl,
      ...rest
    } = props

    return (
      <Box ref={ref} {...rest}>
        <StyledPromoBackgroundImage url={backgroundUrl} parallax>
          <Typography
            component="h2"
            variant="h3"
            children={heading}
            sx={{mb: 4}}
          />
          <Link
            button
            size="large"
            variant="contained"
            color="primary"
            {...link}
          />
        </StyledPromoBackgroundImage>
      </Box>
    )
  },
)

PromoSectionView.displayName = 'PromoSectionView'

export default PromoSectionView
