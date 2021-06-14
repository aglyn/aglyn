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
import FormTemplateRenderProps
  from '@data-driven-forms/react-form-renderer/common-types/form-template-render-props'
import componentTypes from '@data-driven-forms/react-form-renderer/component-types'
import FormRenderer from '@data-driven-forms/react-form-renderer/form-renderer'
import useFormApi from '@data-driven-forms/react-form-renderer/use-form-api'
import FormSpy from '@data-driven-forms/react-form-renderer/form-spy'
import Grid from '@material-ui/core/Grid'
import Box from '@material-ui/core/Box'
import Alert from '@material-ui/lab/Alert'
import AlertTitle from '@material-ui/lab/AlertTitle'
import Button from '@material-ui/core/Button'
import Container from '@material-ui/core/Container'
import { createStyles, Theme, WithStyles, withStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import LinearProgress from '@material-ui/core/LinearProgress'
import React, { useCallback } from 'react'
import { DdfForms } from '../forms'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'
import { mainNavigation, productNames } from '../const'


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

const FormTemplate = (props: FormTemplateRenderProps) => {
  const { formFields, schema } = props
  const { handleSubmit, getState } = useFormApi()
  const { submitting, submitSucceeded, submitFailed, submitErrors, valid, pristine } = getState()

  if (submitFailed) {
    return (
      <>
        <Box mt={2}>
          <Alert severity="error">
            <AlertTitle>Error — Form Submission Failed</AlertTitle>
            Sorry, please try again later. If the issue persists please send a direct email to <em>info@aglyn.com</em>
            <br /><br />
            <small>Error details:</small>
            <pre>{JSON.stringify(submitErrors, null, 2)}</pre>
          </Alert>
        </Box>
      </>
    )
  }

  if (submitSucceeded) {
    return (
      <>
        <Box mt={2}>
          <Alert severity="success">
            <AlertTitle>Success</AlertTitle>
            We have received your submission. If you have any immediate questions, send them to <em>info@aglyn.com</em>
          </Alert>
        </Box>
      </>
    )
  }

  return (
    <Grid
      container
      component={'form'}
      style={{ width: '100%' }}
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
            {submitting && (
              <Box mb={1}>
                <LinearProgress color="secondary" />
              </Box>
            )}
            <Button
              disabled={submitting || !valid || pristine}
              type="submit"
              color="secondary"
              variant="contained"
            >
              {submitting ? 'Please wait...' : 'Continue'}
            </Button>
          </Grid>
        )}
      </FormSpy>
    </Grid>
  )
}

function Contact(props: WithStyles<typeof styles>) {
  const { classes } = props

  const handleSubmit = useCallback(async (values) => {
    return await fetch(`/api/h/f/${DdfForms.formIds.contact}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    })
    .then(res => res.json())
    .then(res => res?.status !== 'success' ? res : undefined)
  }, [])

  return (
    <MainLayout
      title={'Contact Us | Aglyn'}
      centerNavigationItems={mainNavigation}
      productName={productNames.www}
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
                        onSubmit={handleSubmit}
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
