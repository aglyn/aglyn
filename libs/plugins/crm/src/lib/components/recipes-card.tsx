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
  type AglynOrgBilling,
  checkEntitlement,
  CRM_ACTION_RECIPES,
  type CrmActionRecipe,
  type CrmActionRecipeId,
  planLabelGrantingFeature,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay, SrOnly } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Drawer,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CrmRecipeInstallResult,
  CrmRecipeSiteStatus,
} from '../constants/api-routes'
import { type CrmOrgMount, useCrmOrgMount } from '../hooks/use-crm-org-mount'
import { useCrmApi } from './use-crm-api'

/** How many of a site's forms the picker offers before it says it stopped. */
const FORM_OPTION_CEILING = 100

/**
 * The site's Automation → Actions page — where an installed action lives
 * and is edited — or `null` for a site whose subdomain the mount could not
 * answer, which is named and not linked.
 */
function siteActionsHref(mount: CrmOrgMount, hostId: string): string | null {
  const subdomain = mount.siteSubdomain(hostId)
  return subdomain
    ? `${mount.hostsPath}/${encodeURIComponent(subdomain)}/automation/actions`
    : null
}

/**
 * Where a site stands with one recipe, read off the stamps the status route
 * answered. `maybe` is the third answer and the honest one: the site
 * carries actions saved before the stamp existed, any of which could have
 * started from the recipe, so the card neither lists the site as carrying
 * it nor offers the install as if to a blank site. `unread` is the answer
 * before the route has answered, or for a site it did not name.
 */
type SiteStanding = 'installed' | 'maybe' | 'clear' | 'unread'

function standingOf(
  status: ReadonlyMap<string, CrmRecipeSiteStatus> | null,
  hostId: string,
  recipeId: CrmActionRecipeId,
): SiteStanding {
  const site = status?.get(hostId)
  if (!site) return 'unread'
  if (site.installed.includes(recipeId)) return 'installed'
  return site.unstamped > 0 ? 'maybe' : 'clear'
}

/**
 * The stamps of every site of the org, read once the site list is known
 * and again after each install, so the card reports what the documents
 * say rather than what it last did.
 */
function useRecipeStatus(mount: CrmOrgMount | null) {
  const api = useCrmApi(null)
  const [sites, setSites] = useState<Map<string, CrmRecipeSiteStatus> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const { response, payload } = await api('recipe-status', {})
      if (!response.ok) {
        setError(payload?.error ?? 'Which sites carry a recipe could not be read.')
        return
      }
      const answered = (payload.sites ?? []) as CrmRecipeSiteStatus[]
      setSites(new Map(answered.map((site) => [site.hostId, site])))
      setError(null)
    } catch (caught) {
      console.error(caught)
      setError('Which sites carry a recipe could not be read.')
    }
  }, [api])
  const hostsReady = Boolean(mount?.hostsReady)
  useEffect(() => {
    if (hostsReady) void refresh()
  }, [hostsReady, refresh])
  return { sites, error, refresh }
}

/** A site's name, linked into its Actions page when the link is known. */
function SiteLink(props: { mount: CrmOrgMount; hostId: string }) {
  const { mount, hostId } = props
  const href = siteActionsHref(mount, hostId)
  const name = mount.siteName(hostId)
  return href ? <AppLink href={href}>{name}</AppLink> : <>{name}</>
}
SiteLink.displayName = 'SiteLink'

/** One recipe's "Installed on" cell: the sites that carry it, and the ones that may. */
function InstalledOn(props: {
  mount: CrmOrgMount
  recipe: CrmActionRecipe
  status: ReadonlyMap<string, CrmRecipeSiteStatus> | null
}) {
  const { mount, recipe, status } = props
  if (!status) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'Reading…'}
      </Typography>
    )
  }
  const installed = mount.hosts.filter(
    (host) => standingOf(status, host.id, recipe.id) === 'installed',
  )
  const maybe = mount.hosts.filter(
    (host) => standingOf(status, host.id, recipe.id) === 'maybe',
  )
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {installed.length === 0
          ? 'Not installed on any site yet.'
          : installed.map((host, index) => (
              <Fragment key={host.id}>
                {index > 0 ? ', ' : null}
                <SiteLink mount={mount} hostId={host.id} />
              </Fragment>
            ))}
      </Typography>
      {maybe.length > 0 ? (
        <Typography variant="caption" color="text.secondary">
          {`May already have it: ${maybe.map((host) => host.name).join(', ')} — ` +
            'actions there were saved before recipes were tracked.'}
        </Typography>
      ) : null}
    </Stack>
  )
}
InstalledOn.displayName = 'InstalledOn'

interface RecipeInstallFormProps {
  recipe: CrmActionRecipe
  mount: CrmOrgMount
  status: ReadonlyMap<string, CrmRecipeSiteStatus> | null
  onClose: () => void
  onInstalled: (result: CrmRecipeInstallResult, hostId: string) => void
}

/**
 * The install drawer's body: pick the site, pick the form a recipe that
 * needs one is keyed on, confirm. Mounted fresh on every opening — the
 * Drawer unmounts it when closed — so the picks start over each time from
 * the session's site, when that site does not already carry the recipe.
 *
 * The forms are read from the picked site only once a site is picked and
 * only for a recipe that needs one, so a reader installing the other three
 * pays no read. Live forms only: an archived form collects nothing, and a
 * recipe keyed on it would never fire.
 */
function RecipeInstallForm(props: RecipeInstallFormProps) {
  const { recipe, mount, status, onClose, onInstalled } = props
  const firestore = useFirestore()
  const api = useCrmApi(null)
  const needsForm = recipe.needs === 'form'
  const [hostId, setHostId] = useState(() => {
    const pick = mount.createHostId
    return pick && standingOf(status, pick, recipe.id) !== 'installed' ? pick : ''
  })
  const [formId, setFormId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: formRead, status: formsStatus } = useFirestoreCollection<any>(
    () =>
      needsForm && hostId
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'forms'),
            FORM_OPTION_CEILING,
          )
        : null,
    [firestore, needsForm, hostId],
    { idField: '$id' },
  )
  const { rows: formDocs, truncated: formsTruncated } = ceilingedWindow<any>(
    formRead,
    FORM_OPTION_CEILING,
  )
  const formOptions = useMemo(
    () =>
      (formDocs ?? [])
        .filter((form: any) => !form.archivedAt)
        .map((form: any) => ({
          id: form.$id as string,
          name: (String(form.displayName ?? '').trim() || form.$id) as string,
        }))
        .sort((a: { name: string }, b: { name: string }) =>
          a.name.localeCompare(b.name),
        ),
    [formDocs],
  )
  const formsLoading = needsForm && Boolean(hostId) && formsStatus === 'loading'

  const canInstall =
    Boolean(hostId) && (!needsForm || Boolean(formId)) && !busy && !formsLoading

  const handleInstall = async () => {
    if (!canInstall) return
    setBusy(true)
    setError(null)
    try {
      const { response, payload } = await api('recipe-install', {
        hostId,
        recipeId: recipe.id,
        ...(formId ? { formId } : {}),
      })
      if (!response.ok) {
        setError(payload?.error ?? 'The recipe could not be installed.')
        return
      }
      onInstalled(payload as CrmRecipeInstallResult, hostId)
    } catch (caught) {
      console.error(caught)
      setError('The recipe could not be installed.')
    } finally {
      setBusy(false)
    }
  }

  const siteSuffix = (id: string) => {
    const standing = standingOf(status, id, recipe.id)
    if (standing === 'installed') return ' — installed'
    if (standing === 'maybe') return ' — may already have it'
    return ''
  }

  return (
    <Stack spacing={2} sx={{ width: 380, p: 3 }}>
      <Typography variant="h6">{`Install “${recipe.title}”`}</Typography>
      <Typography variant="body2" color="text.secondary">
        {recipe.description}
      </Typography>
      <TextField
        select
        size="small"
        label="Site"
        value={hostId}
        onChange={(event) => {
          setHostId(event.target.value)
          setFormId('')
          setError(null)
        }}
        disabled={busy}
        helperText={
          mount.hosts.length === 0
            ? 'This organization has no sites yet.'
            : 'The action is written into this site’s Automation → Actions.'
        }
        fullWidth
      >
        {mount.hosts.map((host) => (
          <MenuItem
            key={host.id}
            value={host.id}
            disabled={standingOf(status, host.id, recipe.id) === 'installed'}
          >
            {`${host.name}${siteSuffix(host.id)}`}
          </MenuItem>
        ))}
      </TextField>
      {needsForm ? (
        <TextField
          select
          size="small"
          label="Form"
          value={formId}
          onChange={(event) => setFormId(event.target.value)}
          disabled={!hostId || busy || formsLoading}
          helperText={
            !hostId
              ? 'Pick the site first; the recipe is keyed on one of its forms.'
              : formsLoading
                ? 'Loading the site’s forms…'
                : formOptions.length === 0
                  ? 'This site has no live forms.'
                  : formsTruncated
                    ? `Showing the first ${FORM_OPTION_CEILING} forms.`
                    : 'Contacts this form makes are tagged with its name.'
          }
          fullWidth
        >
          {formOptions.map((form) => (
            <MenuItem key={form.id} value={form.id}>
              {form.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {'The action is created enabled, exactly as the recipe defines it. ' +
          'Change anything afterwards from the site’s Automation → Actions page.'}
      </Typography>
      {error ? (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          color="primary"
          disabled={!canInstall}
          onClick={() => void handleInstall()}
        >
          {busy ? 'Installing…' : 'Install'}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
      </Stack>
    </Stack>
  )
}
RecipeInstallForm.displayName = 'RecipeInstallForm'

export interface RecipesCardProps {
  org?: Partial<AglynOrgBilling> | null
}

/**
 * "Recipes" — the CRM's ready-made automations, installed on a site from
 * the organization (AGL-2639).
 *
 * ## Why this card exists at the org level and nowhere else
 *
 * Automation is a site feature: a site's Actions page has a Recipes menu
 * that opens the editor prefilled, and the person saves what they see.
 * The org hub mounts over every site with no editor of its own, so it had
 * no recipes at all, and an org running five sites installed "Welcome a
 * new lead" five times by hand. This card is the org's door: every recipe,
 * the sites that already carry it, and Install, which writes the action
 * into the site the reader picks through the server — the server stamps
 * the recipe, refuses a site outside the org, and refuses a second copy.
 * Under a site the section does not mount it; the site's own menu is the
 * right door there.
 *
 * ## "Installed on" reads the stamp, and says when it cannot
 *
 * The status route answers, per site, the recipes a live action is stamped
 * with and how many live actions carry no stamp. A site with any of the
 * latter is named as one that MAY already have the recipe rather than
 * listed as clear: those actions were saved before the stamp existed and
 * the card cannot tell a hand-built welcome from an installed one.
 *
 * ## Creation opens a drawer
 *
 * Install is a button per row; the picks — the site, and for Tag by form
 * one of that site's forms — live in a drawer, never above the list.
 */
export function RecipesCard(props: RecipesCardProps) {
  const { org } = props
  const mount = useCrmOrgMount()
  const { enqueueSnackbar } = useSnackbar()
  const status = useRecipeStatus(mount)
  const refreshStatus = status.refresh
  const [installing, setInstalling] = useState<CrmActionRecipe | null>(null)
  const [lastInstall, setLastInstall] = useState<{
    hostId: string
    name: string
  } | null>(null)

  const entitled = checkEntitlement(org, 'actions')
  const canInstall = Boolean(mount?.hostsReady) && entitled

  const handleInstalled = useCallback(
    (result: CrmRecipeInstallResult, hostId: string) => {
      setInstalling(null)
      setLastInstall({ hostId, name: result.name })
      enqueueSnackbar(
        `Installed “${result.name}” on ${mount?.siteName(hostId) ?? hostId}`,
        { variant: 'success', persist: false },
      )
      void refreshStatus()
    },
    [enqueueSnackbar, mount, refreshStatus],
  )

  // Mounted by the section only beneath the org hub's provider; the hooks
  // above run either way, so the render order never depends on the mount.
  if (!mount) return null

  const lastInstallHref = lastInstall ? siteActionsHref(mount, lastInstall.hostId) : null
  return (
    <CardDisplay
      header={'Recipes'}
      help={pluginDocsHelp('crmSettings', { anchor: '#recipes' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Ready-made automations for the CRM. Install one on a site and the ' +
            'action is written into that site’s Automation → Actions as the ' +
            'recipe defines it, where it can be edited like any other action.'}
        </Typography>
        {lastInstall ? (
          <Alert
            severity="success"
            onClose={() => setLastInstall(null)}
            action={
              lastInstallHref ? (
                <AppLink
                  componentVariant="button"
                  size="small"
                  color="inherit"
                  href={lastInstallHref}
                >
                  {'Open Automation → Actions'}
                </AppLink>
              ) : undefined
            }
          >
            {`Installed “${lastInstall.name}” on ${mount.siteName(lastInstall.hostId)}.`}
          </Alert>
        ) : null}
        {status.error ? (
          <Typography variant="caption" color="error">
            {status.error}
          </Typography>
        ) : null}
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Recipe'}</TableCell>
              <TableCell>{'Installed on'}</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {CRM_ACTION_RECIPES.map((recipe) => (
              <TableRow key={recipe.id} hover>
                <TableCell sx={{ maxWidth: 360 }}>
                  <Typography variant="body2">{recipe.title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {recipe.description}
                  </Typography>
                </TableCell>
                <TableCell>
                  <InstalledOn mount={mount} recipe={recipe} status={status.sites} />
                </TableCell>
                <TableCell align="right" sx={{ width: 120 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!canInstall}
                    onClick={() => setInstalling(recipe)}
                  >
                    {'Install'}
                    <SrOnly>{` ${recipe.title}`}</SrOnly>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!entitled ? (
          <Typography variant="caption" color="text.secondary">
            {`The actions builder requires the ${planLabelGrantingFeature('actions') ?? 'Pro'} ` +
              'plan — see Billing to upgrade.'}
          </Typography>
        ) : null}
        {mount.hostsReady && mount.hosts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'This organization has no sites yet, so there is nowhere to install a recipe.'}
          </Typography>
        ) : null}
      </Stack>
      <Drawer anchor="right" open={Boolean(installing)} onClose={() => setInstalling(null)}>
        {installing ? (
          <RecipeInstallForm
            recipe={installing}
            mount={mount}
            status={status.sites}
            onClose={() => setInstalling(null)}
            onInstalled={handleInstalled}
          />
        ) : null}
      </Drawer>
    </CardDisplay>
  )
}
RecipesCard.displayName = 'RecipesCard'

export default RecipesCard
