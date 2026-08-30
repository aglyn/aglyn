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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useFirestore, useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { collection, limit, query } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import CreateArtifactDrawer from '../../../../../../components/create-artifact-drawer.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { docsHelp } from '../../../../../../constants/docs-links'
import useFirestoreCollection from '../../../../../../hooks/use-firestore-collection'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * Forms list.
 *
 * A form is a designable document, so this is the components listing's shape:
 * create opens a drawer, a row opens the form's own page, and the besigner is
 * reached from there rather than from the row. The extra column a component
 * list does not have is what the form COLLECTS — a form nobody has submitted
 * to is the one an author most needs to find.
 */
const HostForms: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const createHostResource = useHostResourceApi()

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)

  const { data: formDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'forms'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const forms = (formDocs ?? []).filter((one: any) => !one.archivedAt)

  // Name first, then create (AGL-700) — writing "Untitled form" and
  // navigating leaves a library of rows nobody can tell apart.
  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
      if (creating) return
      setCreating(true)
      setCreateError(null)
      try {
        const formId = Aglyn.createResourceUid()
        await createHostResource({
          hostId,
          resource: 'form',
          id: formId,
          data: {
            displayName: values['displayName'],
            slug:
              Aglyn.normalizeFormSlug(values['displayName']) || formId,
            // A form is created with BOTH halves seeded. `fields` is the
            // declaration the submission path reads and starts empty; the
            // canvas below is the design, seeded with a root and a form node
            // already bound to this id — so the besigner opens on something
            // that satisfies `checkFormContract` rather than on a blank page
            // whose first publish is a list of violations.
            fields: [],
            rootId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
            nodes: {
              [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
                $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                componentId: 'div',
                nodes: ['formRoot'],
              },
              formRoot: {
                $id: 'formRoot',
                componentId: 'form',
                parentId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
                props: { formId, formName: values['displayName'] },
                nodes: [],
              },
            },
          },
        })
        setCreateOpen(false)
        router.push(buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId }))
      } catch (error) {
        console.error(error)
        setCreateError(error)
      } finally {
        setCreating(false)
      }
    },
    [creating, createHostResource, hostId, router, orgSlug, host],
  )

  const openForm = (formId: string) =>
    router.push(buildRoute(Route.FORM_DETAILS, { orgSlug, host, formId }))

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
        },
        {
          children: 'Forms',
          href: buildRoute(Route.HOST_FORMS, { orgSlug, host }),
        },
      ]}
      help="forms"
      header={{
        children: 'Forms',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
      headerRight={
        // The readout leads the create button, as it does on every other
        // artifact list.
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <QuotaReadoutComponent
            ready={formDocs !== undefined}
            used={forms.length}
            limit={Aglyn.FORMS_MAX_PER_HOST}
            noun="form"
          />
          <Button
            size="small"
            variant="contained"
            disabled={creating}
            onClick={() => setCreateOpen(true)}
          >
            {creating ? 'Creating…' : 'Create Form'}
          </Button>
        </Stack>
      }
      aside={
        <CreateArtifactDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create new form"
          onSubmit={handleCreate}
          error={createError}
        />
      }
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <CardDisplay
          header="Forms"
          help={docsHelp('forms', {
            anchor: '#build-a-form',
            excerpt:
              'A form collects submissions, dedupes the people who send them, ' +
              'and can route them to a lead.',
          })}
          contentGutterX
          contentGutterY
        >
          {forms.length === 0 ? (
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2" color="text.secondary">
                {'No forms yet. A form collects submissions, dedupes the people who send them, and can route them to a lead.'}
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={() => setCreateOpen(true)}
              >
                {'Create Form'}
              </Button>
            </Stack>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Name'}</TableCell>
                  <TableCell>{'Slug'}</TableCell>
                  {/* Numeric columns align right in head AND body. */}
                  <TableCell align="right">{'Submissions'}</TableCell>
                  <TableCell align="right">{'Leads'}</TableCell>
                  <TableCell align="right">{'Actions'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {forms.map((form: any) => (
                  <TableRow
                    key={form.$id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openForm(form.$id)}
                  >
                    <TableCell>
                      <Typography variant="body2">
                        {form.displayName ?? form.$id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {form.slug ?? '--'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {form.stats?.submissions ?? 0}
                    </TableCell>
                    <TableCell align="right">
                      {form.stats?.leads ?? 0}
                    </TableCell>
                    <TableCell align="right">
                      <RowActionsMenu
                        label={form.displayName ?? form.$id}
                        items={[
                          {
                            key: 'details',
                            label: 'View details',
                            href: buildRoute(Route.FORM_DETAILS, {
                              orgSlug,
                              host,
                              formId: form.$id,
                            }),
                          },
                          {
                            key: 'besigner',
                            label: 'Edit in besigner',
                            // Through the detail page, which is the one place
                            // that decides what an initial version looks like.
                            // A second minting path is how the two drift.
                            href: buildRoute(Route.FORM_DETAILS, {
                              orgSlug,
                              host,
                              formId: form.$id,
                            }),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardDisplay>
      </Container>
    </DashboardLayout>
  )
}
HostForms.displayName = 'Page:HostForms'

export default HostForms
