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

import {ProductNames} from '@aglyn/shared-data-brand'
import {componentMapper, GridItems} from '@aglyn/shared-ui-jsx'
import FormTemplateRenderProps
  from '@data-driven-forms/react-form-renderer/common-types/form-template-render-props'
import FormRenderer from '@data-driven-forms/react-form-renderer/form-renderer'
import FormSpy from '@data-driven-forms/react-form-renderer/form-spy'
import useFormApi from '@data-driven-forms/react-form-renderer/use-form-api'
import Alert from '@mui/lab/Alert'
import AlertTitle from '@mui/lab/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Grid from '@mui/material/Grid'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import React, {useCallback} from 'react'
import {mainNavigation} from '../const'
import {DdfForms} from '../forms'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'


const FormTemplate = (props: FormTemplateRenderProps) => {
  const {formFields, schema} = props
  const {handleSubmit, getState} = useFormApi()
  const {submitting, submitSucceeded, submitFailed, submitErrors, valid, pristine} = getState()

  if (submitFailed) {
    return (
      <>
        <Box mt={2}>
          <Alert severity="error">
            <AlertTitle>Error — Form Submission Failed</AlertTitle>
            Sorry, please try again later. If the issue persists please send a direct email to{' '}
            <em>info@aglyn.com</em>
            <br />
            <br />
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
            We have received your submission. If you have any immediate questions, send them to{' '}
            <em>info@aglyn.com</em>
          </Alert>
        </Box>
      </>
    )
  }

  return (
    <Grid
      container
      component={'form'}
      style={{width: '100%'}}
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
          <Grid item xs={12} sx={{textAlign: 'center'}}>
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

function Contact(props) {

  const handleSubmit = useCallback(async (values) => {
    return await fetch(`/api/h/f/${DdfForms.formIds.contact}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    })
      .then((res) => res.json())
      .then((res) => (res?.status !== 'success' ? res : undefined))
  }, [])

  return (
    <MainLayout
      title={'Contact Us | Aglyn'}
      centerNavigationItems={mainNavigation}
      productName={ProductNames.WWW}
    >
      <main>
        <Box py={12} bgcolor={'background.paper'}>
          <Container maxWidth={'lg'} sx={{py: 4}}>
            <GridItems
              alignItems="center"
              direction="column"
              spacing={2}
              items={[
                {
                  xs: 12,
                  md: 8,
                  children: (
                    <>
                      <Typography
                        variant={'h2'}
                        component={'h1'}
                        align="center"
                        sx={{
                          mb: 4,
                        }}
                      >
                        Contact Us
                      </Typography>
                      <Typography
                        variant={'h4'}
                        component={'h2'}
                        align="center"
                        sx={{
                          color: 'secondary.main',
                          mb: 4,
                        }}
                      >
                        Looking for more information or need support? Complete the form below.
                      </Typography>
                    </>
                  ),
                },
                {
                  xs: 12,
                  md: 9,
                  children: (
                    <Container maxWidth="sm">
                      <FormRenderer
                        FormTemplate={FormTemplate}
                        componentMapper={componentMapper}
                        schema={DdfForms.ContactFormSchema}
                        onSubmit={handleSubmit}
                      />
                    </Container>
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

export default Contact
