/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { GridItems } from '@aglyn/shared/ui/react'
import TextField from '@data-driven-forms/mui-component-mapper/text-field'
import Textarea from '@data-driven-forms/mui-component-mapper/textarea'
import componentTypes from '@data-driven-forms/react-form-renderer/component-types'
import FormRenderer from '@data-driven-forms/react-form-renderer/form-renderer'
import useFormApi from '@data-driven-forms/react-form-renderer/use-form-api'
import FormSpy from '@data-driven-forms/react-form-renderer/form-spy'
import Grid from '@material-ui/core/Grid'
import Box from '@material-ui/core/Box'
import Button from '@material-ui/core/Button'
import Container from '@material-ui/core/Container'
import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import React, { Children, useState } from 'react'
import { DdfForms } from '../forms'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'


const componentMapper = {
  [componentTypes.TEXT_FIELD]: TextField,
  [componentTypes.TEXTAREA]: Textarea,
}


const styles = (theme: Theme) => createStyles({
  root: {
    paddingTop: theme.mixins.toolbar.minHeight,
    '& $h1': {
      marginBottom: theme.spacing(4),
    },
    '& $h2': {
      color: theme.palette.quaternary.main,
      marginBottom: theme.spacing(4),
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

const asyncSubmit = (values, api) => {
  return new Promise((resolve) =>
    setTimeout(() => {
      console.log('FormValues', values)
      resolve('Yay')
    }, 1500),
  )
}

const FormTemplate = ({ formFields, schema }) => {
  const { handleSubmit, onReset, onCancel, getState } = useFormApi()
  const { submitting, valid, pristine } = getState()

  console.log('form fields', formFields)
  return (
    <Grid
      container
      component={'form'}
      style={{width:'100%'}}
      onSubmit={handleSubmit}
      spacing={3}
    >
      {schema.title}
      {formFields}
      {/*{Children.map(formFields, (child, i) => {*/}
      {/*  // child.props.*/}
      {/*  return <>{child} <br/><br/></>*/}
      {/*})}*/}
      <FormSpy>
        {() => (
          <Grid item xs={12} align="center">
            <Button
              disabled={submitting || !valid || pristine}
              type="submit"
              color="secondary"
              variant="contained"
            >
              Continue
            </Button>
          </Grid>
        )}
      </FormSpy>
    </Grid>
  )
}

interface Props extends WithStyles<typeof styles> {

}

function Contact(props: Props) {
  const { classes } = props
  const [values, setValues] = useState({})

  return (
    <MainLayout
      title={'Contact Us | Aglyn'}
      centerNavigationItems={[
        {
          children: 'Features',
        },
        {
          children: 'Partners',
          items: [],
        },
        {
          children: 'Company',
          items: [],
        },
        {
          children: 'Get Access',
          variant: 'contained',
          color: 'secondary',
        },
      ]}
      productName={'.com'}
      className={classes.root}
    >
      <main>
        <Box py={12} bgcolor={'background.paper'}>
          <Container maxWidth={'lg'} className={classes.container}>
            <GridItems
              alignItems="center"
              direction="column"
              spacing={2}
              items={[
                {
                  xs: 12, md: 8,
                  children: (
                    <>
                      <Typography
                        variant={'h2'}
                        component={'h1'}
                        children={'Contact Us'}
                        align="center"
                        className={classes.h1}
                      />
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        children={'Looking for more information or need support? Complete the form below.'}
                        align="center"
                        className={classes.h2}
                      />
                    </>
                  ),
                },
                {
                  xs: 12, md: 9,
                  children: (
                    <>
                      <FormRenderer
                        FormTemplate={FormTemplate}
                        componentMapper={componentMapper}
                        schema={DdfForms.ContactFormSchema}
                        onSubmit={asyncSubmit}
                        onCancel={() => console.log('Cancelling')}
                        onReset={() => console.log('Resetting')}
                        debug={({ values }) => setValues(values)}
                      />
                    </>
                  ),
                },
              ]}
            />
          </Container>
        </Box>
      </main>
      <SiteFooterView />
    </MainLayout>
  )
}

export default withStyles(styles, { name: 'Page:Contact' })(Contact)
