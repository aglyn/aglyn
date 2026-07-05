/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import img3 from '../public/_static/images/designer/website-designer-custom-element-attributes.png'
import img2 from '../public/_static/images/designer/website-designer-element-categories.png'
import img4 from '../public/_static/images/designer/website-designer-functional-operations.png'
import img1 from '../public/_static/images/designer/website-designer-preview-collage.png'
import { APP_WWW, BRAND_NAMES } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { Image } from '@aglyn/shared-ui-next'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import BackgroundImage from '../components/BackgroundImage'
import { mainNavigation } from '../const'
import MainLayout from '../layouts/MainLayout'
import PromoSectionView from '../views/PromoSectionView'
import SiteFooterView from '../views/SiteFooterView'

const TITLE = 'Build websites for your business goals'

function Index(props: Record<string, unknown>) {
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
        <Box
          sx={{
            py: 6,
          }}
        >
          <Container maxWidth={'lg'} gutterY>
            <GridItems
              alignItems="center"
              direction="row-reverse"
              spacing={2}
              items={[
                {
                  size: { xs: 12 },
                  children: (
                    <>
                      <Typography
                        variant={'h2'}
                        component={'h1'}
                        sx={{ mb: 4 }}
                      >
                        {TITLE}
                      </Typography>
                    </>
                  ),
                },
                {
                  size: {
                    xs: 12,
                    md: 5,
                  },
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
                  size: {
                    xs: 12,
                    md: 7,
                  },
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        // variantMapping={{'h4': 'h3'}}

                        sx={{
                          color: 'quaternary.main',
                          mb: 2,
                        }}
                      >
                        {'The essentials to keep your workflow simple'}
                      </Typography>
                      <Typography
                        variant={'h6'}
                        component={'div'}
                        sx={{
                          color: 'text.secondary',
                          mb: 4,
                          '& > b': { color: 'text.secondary' },
                        }}
                      >
                        <b>A</b>pps <b>G</b>iving <b>L</b>ove for <b>Y</b>our{' '}
                        <b>N</b>etwork
                      </Typography>
                    </>
                  ),
                },
              ]}
            />
          </Container>
        </Box>
      </BackgroundImage>
      <main>
        <Box
          component={'section'}
          sx={{
            bgcolor: 'background.paper',
          }}
        >
          <Box
            component={Container}
            sx={{
              maxWidth: 'lg',
              py: 12,
            }}
          >
            <GridItems
              alignItems="center"
              direction="row"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  size: {
                    xs: 12,
                    md: 4,
                  },
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
                  size: {
                    xs: 12,
                    md: 7,
                  },
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        sx={{ mb: 4 }}
                      >
                        {'Build Your Pages How You Like'}
                      </Typography>
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        sx={{
                          color: 'text.secondary',
                        }}
                      >
                        {
                          'Browse through categories you understand and find the elements that fit the layout you have in mind. Place them on your web page or choose from a template.'
                        }
                      </Typography>
                    </>
                  ),
                },
              ]}
            />
          </Box>
        </Box>
        <Box component={'section'}>
          <Box
            component={Container}
            sx={{
              maxWidth: 'lg',
              py: 12,
            }}
          >
            <GridItems
              alignItems="center"
              direction="row-reverse"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  size: {
                    xs: 12,
                    md: 4,
                  },
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
                  size: {
                    xs: 12,
                    md: 7,
                  },
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        sx={{ mb: 4 }}
                      >
                        {'Custom Elements & Attributes'}
                      </Typography>
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        sx={{
                          color: 'text.secondary',
                        }}
                      >
                        {
                          'Use a combination of elements frequently? Save custom elements and define its attributes to save and reuse later from your element categories.'
                        }
                      </Typography>
                    </>
                  ),
                },
              ]}
            />
          </Box>
        </Box>
        <Box
          component={'section'}
          sx={{
            bgcolor: 'background.paper',
          }}
        >
          <Box
            component={Container}
            sx={{
              maxWidth: 'lg',
              py: 12,
            }}
          >
            <GridItems
              alignItems="center"
              direction="row"
              justifyContent="space-around"
              spacing={2}
              items={[
                {
                  size: {
                    xs: 12,
                    md: 4,
                  },
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
                  size: {
                    xs: 12,
                    md: 7,
                  },
                  children: (
                    <>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        sx={{ mb: 4 }}
                      >
                        {'Perform Operations & Calculate Output'}
                      </Typography>
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        sx={{
                          color: 'text.secondary',
                        }}
                      >
                        {
                          'When you need a more advanced element, use functional operations. Functions can use optional or required parameters to perform simple operations like math or text joining.'
                        }
                      </Typography>
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
          backgroundUrl={
            '/_static/images/backgrounds/patterns/abstract-wave-lines.svg'
          }
          heading={'Get Access and Make Your New Website'}
          link={{
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
