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
import { Container } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Button, Stack } from '@mui/material'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import CreateArtifactDrawer from '../../../../../../components/create-artifact-drawer.component'
import HostFormsCard, {
  type FormQuotaReadout,
} from '../../../../../../components/forms/host-forms-card.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * Forms list.
 *
 * A form is a designable document, so this is the components listing's shape
 * down to the primitives: the card renders `ListTable` with the console's one
 * footer under it, create opens a drawer from the page header, a row opens the
 * form's own page, and the besigner is reached from there rather than from the
 * row. The extra columns a component list does not have are what the form
 * COLLECTS — a form nobody has submitted to is the one an author most needs to
 * find.
 */
const HostForms: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const router = useRouter()
  const createHostResource = useHostResourceApi()

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)
  /** The card publishes its own count and cap; see `onQuota`. */
  const [quota, setQuota] = useState<FormQuotaReadout | null>(null)

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
        // artifact list. The numbers come from the CARD, which owns the
        // listener they are counted from.
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {quota ? (
            <QuotaReadoutComponent
              ready={quota.ready}
              used={quota.used}
              limit={quota.limit}
              noun="form"
            />
          ) : null}
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
        <HostFormsCard
          hostId={hostId}
          onQuota={setQuota}
          // The same drawer the header opens, so the empty state cannot open a
          // second one that knows nothing about the page's create state.
          onCreate={() => setCreateOpen(true)}
        />
      </Container>
    </DashboardLayout>
  )
}
HostForms.displayName = 'Page:HostForms'

export default HostForms
