/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { GridItems } from '@aglyn/shared/ui/react'
import Box from '@material-ui/core/Box'
import Container from '@material-ui/core/Container'
import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import React from 'react'
import BackgroundImage from '../components/BackgroundImage'
import MainLayout from '../layouts/MainLayout'
import Image from 'next/image'
import PromoSectionView from '../views/PromoSectionView'
import SiteFooterView from '../views/SiteFooterView'
import { mainNavigation, productNames } from '../const'


const styles = (theme: Theme) => createStyles({
  header: {
    paddingTop: theme.mixins.toolbar.minHeight,
    '& $h1': {
      marginBottom: theme.spacing(4),
    },
    '& $h2': {
      color: theme.palette.quaternary.main,
    },
  },
  container: {
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(4),
  },

  // KEEP EMPTY
  h1: {},
  h2: {},
})

interface Props extends WithStyles<typeof styles> {

}

function Index(props: Props) {
  const { classes } = props

  return (
    <MainLayout
      title={'Website Designer Platform for Your Business Goals | Aglyn'}
      centerNavigationItems={mainNavigation}
      productName={productNames.www}
    >
      <BackgroundImage
        component={'header'}
        url={'/backgrounds/patterns/abstract-wave-lines.svg'}
        className={classes.header}
      >
        <Box py={6}>
          <Container maxWidth={'lg'} className={classes.container}>
            <GridItems
              alignItems="center"
              direction="row-reverse"
              spacing={2}
              items={[
                {
                  xs: 12, md: 5,
                  children: (
                    <Image
                      src="/designer/website-designer-preview-collage.png"
                      alt="website designer preview collage"
                      layout="responsive"
                      width="504"
                      height="380"
                    />
                  ),
                },
                {
                  xs: 12, md: 7,
                  children: (
                    <>
                      <Typography
                        variant={'h2'}
                        component={'h1'}
                        children={'Website Designer Platform for Your Business Goals'}
                        className={classes.h1}
                      />
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        children={'The essentials to keep your workflow simple'}
                        className={classes.h2}
                      />
                    </>
                  ),
                },
              ]}
            />
          </Container>
        </Box>
      </BackgroundImage>
      <main>
        <Box component={'section'} bgcolor={'background.paper'}>
          <Box component={Container} maxWidth={'lg'} py={12}>
            <GridItems
              alignItems="center"
              direction="row"
              justify="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src="/designer/website-designer-element-categories.png"
                      alt="website designer element category search"
                      layout="responsive"
                      width="400"
                      height="478"
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
                        className={classes.h1}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'Browse through categories you understand and find the elements that fit the layout you have in mind. Place them on your web page or choose from a template.'}
                        className={classes.h2}
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
              justify="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src="/designer/website-designer-custom-element-attributes.png"
                      alt="website designer custom element attributes"
                      layout="responsive"
                      width="400"
                      height="477"
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
                        className={classes.h1}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'Use a combination of elements frequently? Save custom elements and define its attributes to save and reuse later from your element categories.'}
                        className={classes.h2}
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
              justify="space-around"
              spacing={2}
              items={[
                {
                  xs: 12, md: 4,
                  children: (
                    <Image
                      src="/designer/website-designer-functional-operations.png"
                      alt="website designer functional operations"
                      layout="responsive"
                      width="400"
                      height="440"
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
                        className={classes.h1}
                      />
                      <Typography
                        variant={'subtitle1'}
                        component={'p'}
                        children={'When you need a more advanced element, use functional operations. Functions can use optional or required parameters to perform simple operations like math or text joining.'}
                        className={classes.h2}
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
          backgroundUrl={'/backgrounds/patterns/abstract-wave-lines.svg'}
          heading={'Get Access and Make Your New Website'}
          link={{
            as: '/get', href: '/get',
            children: 'Get Your Access',
          }}
        />
      </SiteFooterView>
    </MainLayout>
  )
}

export default withStyles(styles, { name: 'Page:Index' })(Index)
