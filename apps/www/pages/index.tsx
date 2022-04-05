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

import img3 from '/public/_static/images/designer/website-designer-custom-element-attributes.png'
import img2 from '/public/_static/images/designer/website-designer-element-categories.png'
import img4 from '/public/_static/images/designer/website-designer-functional-operations.png'
import img1 from '/public/_static/images/designer/website-designer-preview-collage.png'
import {APP_WWW, BRAND_NAMES} from '@aglyn/shared-data-enums'
import {ContainerComponent, GridItems} from '@aglyn/shared-ui-jsx'
import {Image} from '@aglyn/shared-ui-next'
import Box from '@mui/material/Box'
import Container from '@mui/material/Container'
import Typography from '@mui/material/Typography'
import BackgroundImage from '../components/BackgroundImage'
import {mainNavigation} from '../const'
import MainLayout from '../layouts/MainLayout'
import PromoSectionView from '../views/PromoSectionView'
import SiteFooterView from '../views/SiteFooterView'


const TITLE = 'Build websites for your business goals'

function Index(props) {

  return (
    <MainLayout
      title={APP_WWW.TITLE}
      centerNavigationItems={mainNavigation}
      productName={BRAND_NAMES.WWW}
    >
      <BackgroundImage
        component={'header'}
        url={'/_static/images/backgrounds/patterns/abstract-wave-lines.svg'}
      >
        <Box py={6}>
          <ContainerComponent
            maxWidth={'lg'}
            gutterY
          >
            <GridItems
              alignItems="center"
              direction="row-reverse"
              spacing={2}
              items={[
                {
                  xs: 12,
                  children: (
                    <>
                      <Typography
                        variant={'h2'}
                        component={'h1'}
                        children={TITLE}
                        sx={{mb: 4}}
                      />
                    </>
                  ),
                },
                {
                  xs: 12, md: 5,
                  children: (
                    <Image
                      src={img1}
                      alt="website designer preview collage"
                      width="504"
                      height="380"
                      shimmer
                      priority
                    />
                  ),
                },
                {
                  xs: 12, md: 7,
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        // variantMapping={{'h4': 'h3'}}
                        children={'The essentials to keep your workflow simple'}
                        color="quaternary.main"
                        sx={{mb: 2}}
                      />
                      <Typography
                        variant={'h6'}
                        component={'div'}
                        color="text.secondary"
                        sx={{mb: 4, '& > b': {color: 'text.secondary'}}}
                      >
                        <b>A</b>pps <b>G</b>iving <b>L</b>ove for <b>Y</b>our <b>N</b>etwork
                      </Typography>
                    </>
                  ),
                },
              ]}
            />
          </ContainerComponent>
        </Box>
      </BackgroundImage>
      <main>
        <Box component={'section'} bgcolor={'background.paper'}>
          <Box component={Container} maxWidth={'lg'} py={12}>
            <GridItems
              alignItems="center"
              direction="row"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src={img2}
                      alt="website designer element category search"
                      width="400"
                      height="478"
                      shimmer
                    />
                  ),
                },
                {
                  xs: 12, md: 7,
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        children={'Build Your Pages How You Like'}
                        sx={{mb: 4}}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'Browse through categories you understand and find the elements that fit the layout you have in mind. Place them on your web page or choose from a template.'}
                        color="text.secondary"
                      />
                    </>
                  ),
                },
              ]}
            />
          </Box>
        </Box>
        <Box component={'section'}>
          <Box component={Container} maxWidth={'lg'} py={12}>
            <GridItems
              alignItems="center"
              direction="row-reverse"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src={img3}
                      alt="website designer custom element attributes"
                      width="400"
                      height="477"
                      shimmer
                    />
                  ),
                },
                {
                  xs: 12, md: 7,
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        children={'Custom Elements & Attributes'}
                        sx={{mb: 4}}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'Use a combination of elements frequently? Save custom elements and define its attributes to save and reuse later from your element categories.'}
                        color="text.secondary"
                      />
                    </>
                  ),
                },
              ]}
            />
          </Box>
        </Box>
        <Box component={'section'} bgcolor={'background.paper'}>
          <Box component={Container} maxWidth={'lg'} py={12}>
            <GridItems
              alignItems="center"
              direction="row"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src={img4}
                      alt="website designer functional operations"
                      width="400"
                      height="440"
                      shimmer
                    />
                  ),
                },
                {
                  xs: 12, md: 7,
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        children={'Perform Operations & Calculate Output'}
                        sx={{mb: 4}}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'When you need a more advanced element, use functional operations. Functions can use optional or required parameters to perform simple operations like math or text joining.'}
                        color="text.secondary"
                      />
                    </>
                  ),
                },
              ]}
            />
          </Box>
        </Box>
      </main>
      <SiteFooterView>
        <PromoSectionView
          backgroundUrl={'/_static/images/backgrounds/patterns/abstract-wave-lines.svg'}
          heading={'Get Access and Make Your New Website'}
          link={{
            hrefAs: '/contact',
            href: '/contact',
            children: 'Get Your Access',
          }}
        />
      </SiteFooterView>
    </MainLayout>
  )
}

Index.displayName = 'Index'
Index.aglyn = true

export default Index
