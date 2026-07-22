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
import { mdiBookmarkOutline } from '@aglyn/shared-data-mdi'
import { Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button } from '@mui/material'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, setDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import CreateArtifactDrawer from '../../../../../../components/create-artifact-drawer.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import {
  useHostId,
  useHostSubdomain,
} from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import HostTemplatesCard from '../../../../../../components/templates/host-templates-card.component'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'

/**
 * Templates page (AGL-667): saved starting points for pages, components and
 * layouts, plus anything installed from the marketplace. Nothing here is
 * live until it is used.
 */
const HostTemplates: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()

  // Create sits in the page header alongside Screens and Layouts (AGL-694).
  const [creating, setCreating] = useState(false)
  // Name and kind first, then create (AGL-700). Kind is asked here because
  // it decides which picker the template shows up in (AGL-699), and it is
  // not something a later rename fixes.
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const templateId = Aglyn.createResourceUid()
      const timestamp = Timestamp.now()
      await setDoc(doc(firestore, 'hosts', hostId, 'templates', templateId), {
        hostId,
        kind: values.kind ?? 'page',
        displayName: values.displayName,
        description: values.description ?? '',
        // A canvas needs a ROOT node — `{}` renders as "Invalid node".
        rootId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
        nodes: {
          [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
            $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [],
          },
        },
        // Explicit rather than absent: an absent source reads as "unknown"
        // to the badge and the marketplace update path, not as "mine".
        source: { type: 'authored' },
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      setCreateOpen(false)
      router.push(
        buildRoute(Route.TEMPLATE_DETAILS, { orgSlug, host, templateId }),
      )
    } catch (error) {
      console.error(error)
      setCreateError(error)
      enqueueSnackbar('Could not create the template', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setCreating(false)
    }
    },
    [creating, firestore, hostId, router, orgSlug, host, enqueueSnackbar],
  )

  return (
    <>
      <NextPageTitle screen={'Templates'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        activeTab={buildRoute(Route.HOST_TEMPLATES, { orgSlug, host })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug, host }),
          },
          {
            children: 'Templates',
            href: buildRoute(Route.HOST_TEMPLATES, { orgSlug, host }),
          },
        ]}
        help="templatesLibrary"
        header={{
          children: 'Templates',
          icon: { path: mdiBookmarkOutline.path },
        }}
        headerRight={
          <Button
            size="small"
            variant="contained"
            disabled={creating}
            onClick={() => setCreateOpen(true)}
          >
            {creating ? 'Creating…' : 'Create Template'}
          </Button>
        }
        aside={
          <CreateArtifactDrawer
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            title="Create new template"
            onSubmit={handleCreate}
            error={createError}
            extraFields={TEMPLATE_KIND_FIELD}
          />
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <HostTemplatesCard hostId={hostId} />
        </Container>
      </DashboardLayout>
    </>
  )
}
/**
 * Which picker the template will appear in (AGL-699): page templates on the
 * screens list, layout templates on layouts, component templates on
 * components. Defaulted to `page`, which is what every template created
 * before AGL-700 was hardcoded to.
 */
const TEMPLATE_KIND_FIELD = [
  {
    component: 'select',
    name: 'kind',
    label: 'Kind',
    helperText: 'Decides which list offers this template',
    initialValue: 'page',
    isRequired: true,
    options: [
      { label: 'Page', value: 'page' },
      { label: 'Layout', value: 'layout' },
      { label: 'Component', value: 'component' },
    ],
    validate: [{ type: 'required', message: 'Pick a kind' }],
  },
]

HostTemplates.displayName = 'Page:HostTemplates'

export default HostTemplates
