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

import { AppLink, AppLinkProps } from '@aglyn/shared/ui/react'
import { styled } from '@aglyn/shared/ui/themes'
import Typography from '@mui/material/Typography'
import React, { forwardRef, ReactNode } from 'react'
import { BackgroundImage, BackgroundImageProps } from '../components/BackgroundImage'


const StyledBackgroundImage = styled(BackgroundImage, {
  name: 'BackgroundImage',
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

export interface PromoSectionViewProps extends BackgroundImageProps {
  backgroundUrl: string
  heading: ReactNode
  link: AppLinkProps<'button'>
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
      <StyledBackgroundImage
        ref={ref}
        url={backgroundUrl}
        parallax
        {...rest}
      >
        <Typography
          variant="h3"
          variantMapping={{'h3': 'h2'}}
          children={heading}
          gutterBottom
        />
        <AppLink
          size="large"
          variant="contained"
          color="primary"
          linkType="button"
          {...link}
        />
      </StyledBackgroundImage>
    )
  },
)

PromoSectionView.displayName = 'PromoSectionView'
export { PromoSectionView }
export default PromoSectionView
