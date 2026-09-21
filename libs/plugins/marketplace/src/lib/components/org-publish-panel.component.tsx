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

import {
  PLAN_ENTITLEMENTS,
  PLATFORM_BRAND_NAME,
  pluginDocsHelp,
  resolveMarketplaceFeePct,
  type ConsolePublishableArtifact,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { getTenantEmail } from '@aglyn/shared-util-email'
import { collection, doc, limit, query, where } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
import { publishPluginPath } from '../model/marketplace-paths'
import PublishArtifactDialog from './publish-artifact-dialog.component'

type PublishKind =
  | 'component'
  | 'layout'
  | 'site'
  | 'datasetSchema'
  | 'emailTemplate'
  | 'emailStarter'
  | 'theme'
  | 'plugin'

const artifactName = (artifact: any): string | undefined =>
  artifact?.displayName ?? artifact?.name ?? artifact?.title ?? undefined

/**
 * Email templates are keyed by a fixed catalog key, and the stored doc carries
 * only the design — the human name lives in the catalog.
 */
const emailLabel = (templateKey: string): string =>
  getTenantEmail(templateKey)?.name ?? templateKey

/** Per-kind select label, option text, and empty-state copy. */
const PICKERS: Record<
  PublishKind,
  { label: string; empty: string; optionLabel: (entry: any) => string }
> = {
  component: {
    label: 'Component',
    empty: 'This site has no reusable components to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  layout: {
    label: 'Layout',
    empty: 'This site has no layouts to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  datasetSchema: {
    label: 'Dataset',
    empty: 'This organization has no datasets to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  emailTemplate: {
    label: 'Email',
    empty: 'This site has no designed emails to publish yet.',
    // The doc id IS the catalog key; the design carries no name of its own.
    optionLabel: (entry) => emailLabel(entry.$id),
  },
  // A campaign email is an ordinary screen document, so unlike the row above
  // it carries its own name and there is no catalog to look one up in.
  emailStarter: {
    label: 'Email',
    empty: 'This site has no saved campaign emails to publish yet.',
    optionLabel: (entry) => artifactName(entry) ?? entry.$id,
  },
  site: { label: 'Site', empty: '', optionLabel: () => '' },
  // A theme is a field on the site, so like `site` there is nothing to pick —
  // choosing the source site has already chosen the theme.
  theme: { label: 'Theme', empty: '', optionLabel: () => '' },
  // Plugins don't pick an existing artifact — they're uploaded (AGL-868).
  plugin: { label: 'Plugin', empty: '', optionLabel: () => '' },
}

/**
 * Org-level publish (AGL-776): pick a source site, then a component, a layout,
 * or the whole site (as a template), and publish it under the org's publisher
 * identity. This panel's whole job is choosing WHAT: it names the kind, the
 * scope that holds it and the document, and hands that to the
 * `hostArtifactPublish` zone (AGL-3080), whose widget owns the name/price
 * form, the route and the POST. Plugins publish from their own bundle upload,
 * not here.
 *
 * The per-site publish buttons (Components/Layouts/Setup pages) stay as
 * in-context shortcuts; this is the one place that spans every site.
 */
export function OrgPublishPanel({
  orgId,
  hosts,
  basePath,
  billingPath,
  org,
  orgReady,
}: {
  orgId: string
  hosts: ReadonlyArray<{ id: string; label: string }>
  /**
   * Where the marketplace hub is mounted under this organization, from the
   * shell (AGL-3080). The publish-a-plugin page hangs beneath it.
   */
  basePath: string
  /**
   * Where this organization manages its plan, from the shell's org mount.
   * Absent on a deployment that bills nobody, and the fee notice then says
   * the rate without offering a way to change it.
   */
  billingPath?: string
  /**
   * The org billing doc the shell already loaded, and whether it has
   * settled. Read here rather than through the console's `useCurrentOrg`:
   * the fee shown is a claim about this publisher's plan, and
   * `resolveMarketplaceFeePct(undefined)` answers the FREE rate — so a
   * number rendered during load accuses a paying publisher of the higher
   * cut.
   */
  org?: Parameters<typeof resolveMarketplaceFeePct>[0]
  orgReady: boolean
}) {
  const firestore = useFirestore()
  // The platform's cut, from the SAME helper the checkout deducts with
  // (AGL-2078) rather than a restated constant — a second copy of a rate
  // that moves money is a copy free to disagree with the one that bills.
  const feePct = resolveMarketplaceFeePct(org as never)
  const paidFeePct = PLAN_ENTITLEMENTS.starter.marketplaceFeePct
  const { data: profile } = useFirestoreDoc<any>(
    () => doc(firestore, 'publisherProfiles', orgId || '-none-'),
    [firestore, orgId],
    { idField: '$id' },
  )
  const [sourceHostId, setSourceHostId] = useState('')
  const hostId = sourceHostId || hosts[0]?.id || ''
  const [kind, setKind] = useState<PublishKind>('component')
  const [artifactId, setArtifactId] = useState('')
  const [target, setTarget] = useState<ConsolePublishableArtifact | null>(null)

  // Held at null while there is no host, never addressed as `hosts/-none-`
  // (AGL-1440): an org with ZERO sites has no `hosts[0]`, so the sentinel was
  // not a loading window — it was three permanently rules-denied listens per
  // panel mount, each reopened forever by the refusal loop. The hook issues
  // nothing for a null query and the lists render their empty states.
  const { data: componentDocs } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'components'),
            limit(100),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: layoutDocs } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(collection(firestore, 'hosts', hostId, 'layouts'), limit(100))
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  // Datasets are ORG-scoped (AGL-237), so unlike every other source here they
  // don't depend on the selected site.
  const { data: datasetDocs } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(collection(firestore, 'orgs', orgId, 'datasets'), limit(100))
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: emailDocs } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'emailTemplates'),
            limit(100),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  /**
   * Campaign emails are `kind: 'email'` SCREENS, not entries in the
   * transactional catalog above — a different collection, a different shape,
   * and a different marketplace artifact type. The equality filter is on the
   * query so a site with many pages does not read them all to find its emails.
   */
  const emailScreenDocs = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'screens'),
            where('kind', '==', 'email'),
            limit(100),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  ).data
  const components = useMemo(
    () => (componentDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [componentDocs],
  )
  const layouts = useMemo(
    () => (layoutDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [layoutDocs],
  )
  const datasets = useMemo(
    () => (datasetDocs ?? []).filter((entry: any) => !entry.deletedAt),
    [datasetDocs],
  )
  // Only emails that actually have a saved design are publishable — the doc
  // exists with no `versionId` whenever the besigner was merely opened.
  const emails = useMemo(
    () =>
      (emailDocs ?? []).filter(
        (entry: any) => !entry.deletedAt && entry.versionId,
      ),
    [emailDocs],
  )
  // Same rule, same reason: a screen with no `versionId` was opened and never
  // saved, so there is no design to publish.
  const emailScreens = useMemo(
    () =>
      (emailScreenDocs ?? []).filter(
        (entry: any) => !entry.deletedAt && entry.versionId,
      ),
    [emailScreenDocs],
  )

  // Validate the pick against the current list rather than resetting it in an
  // effect (a classic render-loop source — the reset runs a `setState` after
  // every host/kind change, adding renders that a transient flurry can push
  // past React's update-depth limit). A stale id from another site or
  // artifact type simply reads as "nothing selected" this render, so we never
  // publish it, and the MUI <Select> value stays in range every render.
  const activeList =
    kind === 'component'
      ? components
      : kind === 'layout'
        ? layouts
        : kind === 'datasetSchema'
          ? datasets
          : kind === 'emailTemplate'
            ? emails
            : kind === 'emailStarter'
              ? emailScreens
              : []
  // One descriptor per source kind, so adding an artifact type is a row here
  // rather than another arm of a nested ternary in the JSX below.
  const picker = PICKERS[kind]
  const selectedId = activeList.some((entry: any) => entry.$id === artifactId)
    ? artifactId
    : ''

  const hostLabel = hosts.find((host) => host.id === hostId)?.label

  /*
   * WHAT IS BEING PUBLISHED, in this console's own words (AGL-3080).
   *
   * This used to build seven marketplace requests — an endpoint, a payload
   * key and a noun each — which made a panel about the org's own artifacts a
   * file that could not be right without being kept in step with a plugin's
   * routes. It now says only what the thing IS and which scope holds it; the
   * `hostArtifactPublish` zone's widget decides where it goes.
   *
   * ⚠️ Datasets are ORG-scoped and every other kind is a site's, which is why
   * both scopes ride and neither is inferred from the other.
   */
  const openPublish = () => {
    const named =
      kind === 'site'
        ? hostLabel
        : kind === 'theme'
          ? hostLabel && `${hostLabel} theme`
          : kind === 'emailTemplate'
            ? emailLabel(selectedId)
            : artifactName(
                activeList.find((entry: any) => entry.$id === selectedId),
              )
    setTarget({
      kind,
      hostId,
      orgId,
      // Absent for a kind that IS the site — a whole site template, a theme —
      // where `hostId` above already names it.
      ...(kind === 'site' || kind === 'theme'
        ? {}
        : { artifactId: selectedId }),
      ...(named ? { displayName: named } : {}),
    })
  }

  // Dataset schemas publish from the org, so they need no source site — an
  // org with datasets but no sites yet can still publish one.
  const canPublish =
    kind === 'datasetSchema'
      ? Boolean(orgId && selectedId)
      : Boolean(hostId && (kind === 'site' || kind === 'theme' || selectedId))

  // A publisher profile (with a handle) is required server-side; guide the
  // user there rather than letting the publish 412.
  if (profile !== undefined && !profile?.handle) {
    return (
      <CardDisplay
        header={'Publish to the marketplace'}
        // The SAME card, in the branch where it cannot be used — and until
        // AGL-2130 the only branch with no help. A reader who arrives here is
        // by definition the one who does not yet know how publishing works,
        // so this is the branch that can least afford to drop the link.
        help={pluginDocsHelp('publisherHandbook', {
          anchor: '#where-to-publish-from',
          excerpt:
            'Publishing needs an organization publisher profile with a handle. ' +
            'Set one up on the Profile tab first.',
        })}
        contentGutterX
        contentGutterY
      >
        <Alert severity="info">
          {'Set up your organization’s publisher profile in the Profile tab ' +
            'before publishing.'}
        </Alert>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      header={'Publish to the marketplace'}
      help={pluginDocsHelp('publisherHandbook', {
        anchor: '#where-to-publish-from',
        excerpt:
          'Publish a component, layout, dataset schema, email template, or ' +
          'whole site so other organizations can install it.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 480 }}>
        <Typography variant="body2" color="text.secondary">
          {'Publish a component, layout, dataset schema, email template, or ' +
            'an entire site from your organization so other organizations ' +
            'can install it. Your live site is unaffected.'}
        </Typography>
        {/* What Aglyn keeps (AGL-2078). Until now this number appeared in
            exactly one place in the console — the STAFF override table —
            while `resolveMarketplaceFeePct` deducted it from every sale. A
            publisher chose a price and learned the cut from the payout.

            Rendered only once the org doc has arrived:
            `resolveMarketplaceFeePct(undefined)` returns the free-plan rate,
            so a number shown during load accuses a paying publisher of the
            higher cut — and the same helper prices a DEAD subscription as
            free-plan while `org.plan` still reads Pro, which is precisely
            the case a publisher has no other way to notice. */}
        {orgReady ? (
          <Alert severity={feePct > paidFeePct ? 'warning' : 'info'}>
            {feePct > paidFeePct
              ? `${PLATFORM_BRAND_NAME} keeps ${feePct}% of each sale on your current plan. ` +
                `On a paid plan it is ${paidFeePct}%.`
              : `${PLATFORM_BRAND_NAME} keeps ${feePct}% of each sale. Payment processing ` +
                'fees are charged separately by Stripe.'}
            {feePct > paidFeePct && billingPath ? (
              <Box sx={{ mt: 1 }}>
                <AppLink href={billingPath}>{'See plans'}</AppLink>
              </Box>
            ) : null}
          </Alert>
        ) : null}
        {hosts.length > 1 && kind !== 'datasetSchema' ? (
          <TextField
            select
            size="small"
            label="From site"
            value={hostId}
            onChange={(event) => setSourceHostId(event.target.value)}
          >
            {hosts.map((host) => (
              <MenuItem key={host.id} value={host.id}>
                {host.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField
          select
          size="small"
          label="What to publish"
          value={kind}
          onChange={(event) => setKind(event.target.value as PublishKind)}
        >
          <MenuItem value="component">{'A component'}</MenuItem>
          <MenuItem value="layout">{'A layout'}</MenuItem>
          <MenuItem value="datasetSchema">{'A dataset schema'}</MenuItem>
          <MenuItem value="emailTemplate">{'An email template'}</MenuItem>
        <MenuItem value="emailStarter">
          {'A campaign email others can start from'}
        </MenuItem>
          <MenuItem value="theme">{'This site’s theme'}</MenuItem>
          <MenuItem value="site">{'This entire site (as a template)'}</MenuItem>
          <MenuItem value="plugin">{'A plugin (upload a bundle)'}</MenuItem>
        </TextField>
        {kind === 'plugin' ? (
          <Typography variant="body2" color="text.secondary">
            {'Upload a self-contained plugin bundle and its manifest. It ' +
              'publishes sandboxed and is signed after a reviewer verifies ' +
              'it. Publish it to the marketplace, or keep it private to your ' +
              'organization — private plugins take the same review path.'}
          </Typography>
        ) : kind === 'site' ? (
          <Typography variant="body2" color="text.secondary">
            {'Publishes this site’s current published screens and theme as an ' +
              'installable starting point.'}
          </Typography>
        ) : kind === 'theme' ? (
          <Typography variant="body2" color="text.secondary">
            {'Publishes this site’s colors, typography, shape and component ' +
              'styles on their own. Both light and dark schemes are required, ' +
              'and text has to be readable against its background — you will ' +
              'be told before anything is published if not.'}
          </Typography>
        ) : activeList.length ? (
          <TextField
            select
            size="small"
            label={picker.label}
            value={selectedId}
            onChange={(event) => setArtifactId(event.target.value)}
          >
            {activeList.map((entry: any) => (
              <MenuItem key={entry.$id} value={entry.$id}>
                {picker.optionLabel(entry)}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {picker.empty}
          </Typography>
        )}
        {kind === 'emailTemplate' && activeList.length ? (
          <Typography variant="caption" color="text.secondary">
            {'Installing an email template adds it as a draft version — it ' +
              'never replaces the design a site is already sending.'}
          </Typography>
        ) : null}
        {/* The publish rules, said before the publish rather than as a 422.
            They are narrower than the ones for a page, and the reason is worth
            a sentence: a design published here is mailed by other people, from
            a sending domain everyone shares. */}
        {kind === 'emailStarter' && activeList.length ? (
          <Typography variant="caption" color="text.secondary">
            {'A published email is copied into the sites that install it, so ' +
              'later edits of yours never reach them. Images must come from ' +
              'your media library or be inline, links must be https, and rich ' +
              'text blocks are not published — an email you send is loaded ' +
              'inside somebody else’s recipient’s mail client.'}
          </Typography>
        ) : null}
        <Box>
          {/* Publishing a plugin is a page now (AGL-1078), so this is a link
              — the destination has a URL, a draft that survives a reload,
              and room for the checklist. AppLink, never an href on Button:
              a raw href full-reloads the SPA. */}
          {kind === 'plugin' ? (
            <AppLink href={publishPluginPath(basePath)}>
              <Button variant="contained" color="primary">
                {'Publish a plugin…'}
              </Button>
            </AppLink>
          ) : (
            <Button
              variant="contained"
              color="primary"
              disabled={!canPublish}
              onClick={openPublish}
            >
              {'Publish…'}
            </Button>
          )}
        </Box>
      </Stack>
      {/* No `useSlotWidgets` gate on the button above, unlike the pages that
          offer a publish in passing: this panel is drawn inside the
          marketplace's own surface, so a workspace that cannot reach the
          zone's widget never reaches this panel either. */}
      {/* Rendered directly, not through the `hostArtifactPublish` zone. The
          zone exists so a page that offers a publish IN PASSING — a site's
          layouts list — can do it without importing this plugin. This panel
          IS this plugin, and a slot here would be the marketplace asking the
          shell to find the marketplace. */}
      <PublishArtifactDialog artifact={target} onClose={() => setTarget(null)} />
    </CardDisplay>
  )
}
OrgPublishPanel.displayName = 'OrgPublishPanel'

export default OrgPublishPanel
