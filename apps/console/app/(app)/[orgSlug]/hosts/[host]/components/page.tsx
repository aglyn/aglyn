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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, Stack } from '@mui/material'
import TemplateGalleryDialog from '../../../../../../components/templates/template-gallery-dialog.component'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, setDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import HostComponentsCard from '../../../../../../components/host-components-card.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import hostNavTabItems from '../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'

/**
 * Components page (AGL-250): reusable components moved off the dashboard —
 * named canvas subtrees that render identically on every screen using them.
 */
const HostComponents: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()

  // Create lives in the page header, not inside the card — that is where
  // Screens and Layouts put theirs, and a create action buried in the list
  // it creates into reads as part of the list (AGL-693).
  // Component templates, not components (AGL-699).
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const handleCreate = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      const componentId = Aglyn.createResourceUid()
      const timestamp = Timestamp.now()
      await setDoc(doc(firestore, 'hosts', hostId, 'components', componentId), {
        hostId,
        displayName: 'Untitled component',
        description: '',
        // A canvas needs a ROOT node to render — an empty `{}` renders as
        // "Invalid node" in the besigner (AGL-693).
        rootId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
        nodes: {
          [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
            $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [],
          },
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      router.push(
        buildRoute(Route.COMPONENT_DETAILS, { orgSlug, host, componentId }),
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not create the component', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setCreating(false)
    }
  }, [creating, firestore, hostId, router, orgSlug, host, enqueueSnackbar])

  return (
    <>
      <NextPageTitle screen={'Components'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Components',
            href: buildRoute(Route.HOST_COMPONENTS, { orgSlug,  host }),
          },
        ]}
        help="components"
        header={{
          children: 'Reusable Components',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
        headerRight={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setTemplatesOpen(true)}
            >
              {'Templates'}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating ? 'Creating…' : 'Create Component'}
            </Button>
          </Stack>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <HostComponentsCard hostId={hostId} />
          <TemplateGalleryDialog
            hostId={hostId}
            open={templatesOpen}
            onClose={() => setTemplatesOpen(false)}
            existingSlugs={[]}
            screenCount={0}
            kind="component"
            title="Start from a component template"
            blurb="Component templates add a ready-made element tree you can restyle in the besigner. Existing components are never touched."
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostComponents.displayName = 'Page:HostComponents'

export default HostComponents
