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

import { BRAND_NAMES } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import {
  FormRenderer,
  FormSpy,
  type FormTemplateRenderProps,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Grid,
  LinearProgress,
  Typography,
} from '@mui/material'
import { useCallback } from 'react'
import { mainNavigation } from '../const'
import { DdfForms } from '../forms'
import MainLayout from '../layouts/MainLayout'
import SiteFooterView from '../views/SiteFooterView'

const FormTemplate = (props: FormTemplateRenderProps) => {
  const { formFields, schema } = props
  const { handleSubmit, getState } = useFormApi()
  const {
    submitting,
    submitSucceeded,
    submitFailed,
    submitErrors,
    valid,
    pristine,
  } = getState()

  if (submitFailed) {
    return (
      <>
        <Box sx={{
          mt: 2
        }}>
          <Alert severity="error">
            <AlertTitle>Error — Form Submission Failed</AlertTitle>
            Sorry, please try again later. If the issue persists please send a
            direct email to <em>info@aglyn.com</em>
            <br />
            <br />
            <small>Error details:</small>
            <pre>{JSON.stringify(submitErrors, null, 2)}</pre>
          </Alert>
        </Box>
      </>
    );
  }

  if (submitSucceeded) {
    return (
      <>
        <Box sx={{
          mt: 2
        }}>
          <Alert severity="success">
            <AlertTitle>Success</AlertTitle>
            We have received your submission. If you have any immediate
            questions, send them to <em>info@aglyn.com</em>
          </Alert>
        </Box>
      </>
    );
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
          <Grid sx={{ textAlign: 'center' }} size={12}>
            {submitting && (
              <Box sx={{
                mb: 1
              }}>
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
  );
}

function Contact(props: Record<string, unknown>) {
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
      productName={BRAND_NAMES.WWW}
    >
      <main>
        <Box
          sx={{
            py: 12,
            bgcolor: 'background.paper'
          }}>
          <Container maxWidth={'lg'} gutterY>
            <GridItems
              alignItems="center"
              direction="column"
              spacing={2}
              items={[
                {
                  size: {
                    xs: 12,
                    md: 8,
                  },
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
                        Looking for more information or need support? Complete
                        the form below.
                      </Typography>
                    </>
                  ),
                },
                {
                  size: {
                    xs: 12,
                    md: 9,
                  },
                  children: (
                    <Container maxWidth="sm">
                      <FormRenderer
                        FormTemplate={FormTemplate}
                        componentMapper={simpleComponentMapper}
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
  );
}

export default Contact
