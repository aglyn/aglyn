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
import { Button, Stack } from '@mui/material'
import CreateArtifactDrawer from '../../../../../../components/create-artifact-drawer.component'
import TemplateGalleryDialog from '../../../../../../components/templates/template-gallery-dialog.component'
import { useHostResourceApi } from '@aglyn/tenant-feature-instance'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import HostComponentsCard, {
  type ComponentQuotaReadout,
} from '../../../../../../components/host-components-card.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import PluginWidgetSlot from '../../../../../../components/plugin-widget-slot.component'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import useOrgScope, { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import componentCreateSeed from '../../../../../../utils/component-create-seed'

/**
 * Components page (AGL-250): reusable components moved off the dashboard —
 * named canvas subtrees that render identically on every screen using them.
 */
const HostComponents: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  // The org the header's plugin actions start under (AGL-3051): the scope's,
  // read from context, and `undefined` until the scope names one.
  const { currentOrg } = useOrgScope()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()

  /** The card publishes its own count and cap; see `onQuota`. */
  const [quota, setQuota] = useState<ComponentQuotaReadout | null>(null)

  // Create lives in the page header, not inside the card — that is where
  // Screens and Layouts put theirs, and a create action buried in the list
  // it creates into reads as part of the list (AGL-693).
  // Component templates, not components (AGL-699).
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  // Name first, then create (AGL-700) — writing "Untitled component" and
  // navigating left the library full of rows nobody could tell apart.
  const createHostResource = useHostResourceApi()
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const handleCreate = useCallback(
    async (values: Record<string, any>) => {
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const componentId = Aglyn.createResourceUid()
      // Where it will be used, and what it starts as (AGL-3287): a page
      // component starts blank as it always has; an email block is marked as
      // one and starts as the email plugin's Header or Footer, or blank.
      const seed = await componentCreateSeed(values)
      // Component DOC creation is API-only by rule (`allow create: if
      // isStaff()`), same as screens/layouts/templates — the resources route
      // enforces the reusableComponents entitlement server-side (AGL-473).
      // This wrote setDoc directly and every click died on a rules denial;
      // the besigner's save-as-reusable path never hit it because it goes
      // through the API.
      await createHostResource({
        hostId,
        resource: 'reusableComponent',
        id: componentId,
        data: {
          // No `hostId` here (AGL-1384): it duplicated the document's own
          // path — hosts/{hostId}/components/{id} — and nothing read it. The
          // other two component creators never sent it, so the collection was
          // already inconsistent about carrying it.
          displayName: values.displayName,
          description: values.description ?? '',
          // `rootId` and `nodes`, and `kind` for an email block. A canvas
          // needs a ROOT node to render — an empty `{}` renders as "Invalid
          // node" in the besigner (AGL-693) — which every seed has.
          ...seed,
        },
      })
      setCreateOpen(false)
      router.push(
        buildRoute(Route.COMPONENT_DETAILS, { orgSlug, host, componentId }),
      )
    } catch (error) {
      console.error(error)
      setCreateError(error)
      enqueueSnackbar('Could not create the component', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setCreating(false)
    }
    },
    [creating, createHostResource, hostId, router, orgSlug, host, enqueueSnackbar],
  )

  return (
    <DashboardLayout
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
        // The readout leads the create buttons, as it does on Sites, screens,
        // layouts and templates (AGL-2113/AGL-2501). The numbers come from the
        // CARD, which owns the listener they are counted from.
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {quota ? (
            <QuotaReadoutComponent
              ready={quota.ready}
              used={quota.used}
              limit={quota.limit}
              noun="component"
            />
          ) : null}
          <Stack direction="row" spacing={1}>
            {/* Other ways to start a component, from plugins (AGL-3051). */}
            <PluginWidgetSlot
              slot="hostComponents"
              hostId={hostId}
              orgId={currentOrg?.$id}
            />
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
              onClick={() => setCreateOpen(true)}
            >
              {creating ? 'Creating…' : 'Create Component'}
            </Button>
          </Stack>
        </Stack>
      }
      aside={
        <CreateArtifactDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create new component"
          onSubmit={handleCreate}
          error={createError}
          extraFields={COMPONENT_CREATE_FIELDS}
        />
      }
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <HostComponentsCard
          hostId={hostId}
          onQuota={setQuota}
          // Same two actions as the header, so the empty state opens the
          // page's own drawer and gallery rather than a second pair.
          onCreate={() => setCreateOpen(true)}
          onBrowseTemplates={() => setTemplatesOpen(true)}
        />
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
  )
}
/**
 * Where the new component will be used, and — for an email — what it starts
 * as (AGL-3287). Asked in the words of someone who has never built a site:
 * pages and emails, a header and a footer. The page component is the default
 * because it is what this button has always made.
 */
const COMPONENT_CREATE_FIELDS = [
  {
    component: 'select',
    name: 'kind',
    label: 'Where will you use it?',
    helperText:
      'Pages are your website. Emails are the messages your site sends.',
    initialValue: 'site',
    isRequired: true,
    disableDefaultOption: true,
    options: [
      { value: 'site', label: 'On pages' },
      { value: 'email', label: 'In emails' },
    ],
    validate: [{ type: 'required', message: 'Pick where you will use it' }],
  },
  {
    component: 'select',
    name: 'starter',
    label: 'Start with',
    helperText: 'Change anything you like after.',
    initialValue: 'header',
    disableDefaultOption: true,
    condition: { when: 'kind', is: 'email' },
    options: [
      { value: 'header', label: 'Header — your logo and company name' },
      {
        value: 'footer',
        label: 'Footer — your address, and why people get your emails',
      },
      { value: 'blank', label: 'Blank — start with nothing' },
    ],
  },
]

HostComponents.displayName = 'Page:HostComponents'

export default HostComponents
