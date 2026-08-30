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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import { AppLink, CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Typography } from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { templateProvenance } from '../model/template-provenance'
import { createEmailScreen } from '../utils/create-email-screen'

// The besigner route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
// versions/[versionId]/besigner`. This built `/{hostDocId}/screens/…`, the
// pre-AGL-621/622 shape — so every "Edit"/"Design" jump out of the Emails
// page landed on a 404, including the one right after creating a new email
// (AGL-685). Takes the resolved org slug + subdomain, not a host doc id.
const besignerHref = (
  orgSlug: string,
  host: string,
  screenId: string,
  versionId: string,
) =>
  buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })

/**
 * THE TEMPLATES: reusable besigner documents an email is built from.
 *
 * A template is a screen document with `kind: 'email'`, kept out of the main
 * Screens list and opened in the besigner with only email-safe components on
 * offer. It is not itself a message — a message is what a campaign sends, and
 * one template can be behind many of them, which is why the row leads to the
 * template's own page rather than straight into the editor.
 *
 * A template is not necessarily this org's. One installed from a marketplace
 * listing appears here beside the locally authored ones, carries its
 * publisher's provenance on the same document, and opens the same detail
 * page; the chip beside its name is what distinguishes them.
 */
export function EmailScreensCard(props: {
  hostId: string
  /**
   * The emails hub URL, so a row can link to the template's own page.
   *
   * Optional because the shell hands `basePath` to the page and not to this
   * card, and a card rendered without one still lists and still opens the
   * besigner — it simply offers no detail link rather than building a
   * half-formed URL.
   */
  basePath?: string
}) {
  const { hostId, basePath } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailScreens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt && screen.kind === 'email')
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const handleCreate = async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        hostId,
        createHostResource,
        createHostVersion,
      )
      if (orgSlug && subdomain) {
        void router.push(
          besignerHref(orgSlug, subdomain, screenId, versionId),
        )
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the template failed', {
        variant: 'error',
      })
    }
  }

  const handleDelete = (screen: any) => async () => {
    const confirmed = await confirm({
      title: 'Delete this template?',
      description:
        `"${screen.displayName ?? 'Untitled template'}" will be removed. ` +
        'Emails already sent from it keep their reports.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await updateDoc(doc(firestore, 'hosts', hostId, 'screens', screen.$id), {
      deletedAt: Timestamp.now(),
    })
  }

  return (
    <CardDisplay
      header={'Templates'}
      help={pluginDocsHelp('designedEmails', { anchor: '#create-a-template' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {emailScreens.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Design a reusable email here, then send it from a campaign. A ' +
              'new template opens in the besigner with email-safe components ' +
              'only.'}
          </Typography>
        ) : (
          emailScreens.map((screen: any) => (
            <Stack
              key={screen.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {/*
                 * The name is the way IN, the same shape the screens,
                 * components, layouts and templates listings use: a row opens
                 * the resource's own page, and the editor is reached from
                 * there. Edit stays beside it because a template that is
                 * being worked on is opened far more often than it is read
                 * about.
                 */}
                {basePath ? (
                  <AppLink href={`${basePath}/templates/${screen.$id}`}>
                    {screen.displayName ?? 'Untitled template'}
                  </AppLink>
                ) : (
                  (screen.displayName ?? 'Untitled template')
                )}
              </Typography>
              {/*
                * WHOSE template this is, where the reader is choosing between
                * them. An installed one is versioned by its publisher and can
                * be withdrawn, which is not a property a name can carry.
                */}
              {templateProvenance(screen).origin === 'installed' ? (
                <Chip size="small" label="Installed" />
              ) : null}
              <Button
                size="small"
                disabled={!orgSlug || !subdomain}
                onClick={() =>
                  void router.push(
                    besignerHref(
                      orgSlug,
                      subdomain,
                      screen.$id,
                      screen.versionId,
                    ),
                  )
                }
              >
                {'Edit'}
              </Button>
              <Button size="small" color="error" onClick={handleDelete(screen)}>
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        <Button
          size="small"
          color="primary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() => void handleCreate()}
        >
          {'New template'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
EmailScreensCard.displayName = 'EmailScreensCard'

export default EmailScreensCard
