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
  buildRoute,
  PageHeaderRecord,
  pluginDocsHelp,
  Route,
} from '@aglyn/aglyn'
import { artifactRenameListKeys } from '@aglyn/aglyn/app-utils/artifact-list-keys'
import { ICON_VARIANT_BESIGNER } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { Suspense, useMemo, useState } from 'react'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { templateProvenance } from '../model/template-provenance'
import EmailDesignPreview from './email-design-preview'
import {
  EMAIL_TEMPLATE_RECIPIENTS_ZONE,
  EMAIL_TEMPLATE_REPORT_ZONE,
} from './email-zones'
import { Section } from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'

const previewDocsHelp = pluginDocsHelp('designedEmails', {
  anchor: '#send-it',
  excerpt:
    'The template as an inbox receives it, drawn by the same renderer the ' +
    'send path uses. Merge tokens are left standing — a real send fills them ' +
    'from each recipient.',
})

const templateDocsHelp = pluginDocsHelp('designedEmails', {
  anchor: '#send-it',
  excerpt:
    'One email template: its name, where it came from, and what it looks ' +
    'like. The emails sent from it are reported beneath, by the plugin that ' +
    'sends them.',
})

export interface EmailTemplateDetailProps {
  hostId: string
  /** The `kind: 'email'` screen document this page is about. */
  screenId: string
  /** The emails hub URL, for the way back to the templates list. */
  basePath: string
}

/**
 * ONE EMAIL TEMPLATE: what it looks like, and what it has done.
 *
 * ## What was missing
 *
 * A template had a row in a list and no page. The only way to see one was to
 * open the besigner, which is the editor — it draws canvas nodes in a
 * browser, not the HTML an inbox receives — and the only way to see how it
 * performed was to find each message sent from it and read those reports one
 * at a time. A template used by six messages had its engagement in six places
 * and nowhere.
 *
 * ## Not necessarily this org's template
 *
 * A template can be installed from a marketplace listing, in which case its
 * content is versioned by somebody else and can be withdrawn. Provenance and
 * standing are read off the document itself — see `template-provenance.ts` —
 * so this page costs no marketplace read and still never presents an
 * installed template as locally authored.
 *
 * ## What this page reads
 *
 * The screen document and its published version. The messages sent from the
 * template are a send's, and sends are the campaign owner's: this page hosts
 * two zones that plugin fills — the report of what those messages did, and
 * who received them — handing over the site, the template and this page's
 * base path, and reads none of the sends itself (AGL-3080).
 */
export function EmailTemplateDetail(props: EmailTemplateDetailProps) {
  const { hostId, screenId, basePath } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const Zone = useConsoleWidgetSlot()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()

  /*==========================================
   * RENAMING THE DESIGN, on its own page.
   *
   * The name is the only thing that tells one design from another in the
   * campaign composer's picker, and until now nothing could change it — so a
   * site accumulated indistinguishable "Untitled email" rows. Edit lives
   * here, on the record's detail page, like every other record edit.
   *
   * `null` means "not editing": the field shows the live document's name
   * until the reader types, so an untouched field never writes a stale seed
   * back — only a value the reader actually entered is ever saved, and only
   * the one field.
   *=========================================*/
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const handleRename = async () => {
    const next = (nameDraft ?? '').trim()
    if (!next || renaming) return
    setRenaming(true)
    try {
      await updateDoc(doc(firestore, 'hosts', hostId, 'screens', screenId), {
        displayName: next,
        // The keys the design lists find it by (AGL-3321).
        ...artifactRenameListKeys('screens', next),
      })
      setNameDraft(null)
      enqueueSnackbar('Design renamed', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The design could not be renamed', { variant: 'error' })
    } finally {
      setRenaming(false)
    }
  }

  const { data: screen, status } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'screens', screenId),
    [firestore, hostId, screenId],
    { idField: '$id' },
  )
  // Three states, not two: a document still loading and one that does not
  // exist both arrive as `undefined`, and rendering an empty report for the
  // second is how a mistyped id reads as a template nobody ever sent.
  const notFound = status !== 'loading' && !screen
  const versionId: string | undefined = screen?.versionId

  const { data: version } = useFirestoreDoc<any>(
    () =>
      versionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            screenId,
            'versions',
            versionId,
          )
        : null,
    [firestore, hostId, screenId, versionId],
  )

  const provenance = useMemo(() => templateProvenance(screen), [screen])

  const listUrl = `${basePath}/templates`
  const besignerUrl =
    orgSlug && subdomain && versionId
      ? buildRoute(Route.SCREEN_BESIGNER, {
          orgSlug,
          host: subdomain,
          screenId,
          versionId,
        })
      : ''

  /*
   * The header's actions: the way back, and the way in.
   *
   * The same pair the screen, component, template and layout detail pages
   * carry — a link to the listing and a contained button into the besigner
   * wearing the besigner icon. It hangs off `CardDisplay`'s header rather
   * than the page header because Emails is a surface with a SECTION RAIL: an
   * action beside the page title would read as the whole surface's, and this
   * one belongs to the template the section is showing. The rule is the
   * console's own — page header where there are no sections, section card
   * header where there are — and it is why the Forms detail surface, which
   * has no rail, publishes its besigner button upward instead.
   */
  const headerActions = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        component={AppLink as any}
        {...({ componentVariant: 'naked', nativeButton: false } as any)}
        href={listUrl}
        size="small"
        color="primary"
      >
        {'All templates'}
      </Button>
      {/*
        * A LINK once there is somewhere to go, and a plain disabled button
        * until then.
        *
        * Not one control with `disabled` on it: `disabled` renders an anchor
        * greyed out and still followable, so a template that has never been
        * saved would offer a besigner URL missing its version — a 404, which
        * reads as a broken console rather than as an empty template.
        */}
      {besignerUrl ? (
        <Button
          component={AppLink as any}
          {...({ componentVariant: 'naked', nativeButton: false } as any)}
          href={besignerUrl}
          size="small"
          variant="contained"
          startIcon={
            <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
          }
        >
          {'Edit in besigner'}
        </Button>
      ) : (
        <Button
          size="small"
          variant="contained"
          disabled
          startIcon={
            <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
          }
        >
          {'Edit in besigner'}
        </Button>
      )}
    </Stack>
  )

  if (notFound) {
    return (
      <CardDisplay
        header={'Email template'}
        help={templateDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Typography variant="body2" color="text.secondary">
          {'This template could not be loaded. It may have been deleted.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={3}>
      {/* The page heading and the trail name the template; this card is
          then free to say what it holds rather than repeating the title. */}
      <PageHeaderRecord
        title={screen ? screen.displayName || screenId : undefined}
      />
      <CardDisplay
        header={'Email template'}
        help={templateDocsHelp}
        contentGutterX
        contentGutterY
        HeaderProps={{ action: headerActions }}
      >
        <Stack spacing={3}>
          {provenance.note ? (
            <Alert severity={provenance.warn ? 'warning' : 'info'}>
              {provenance.note}
            </Alert>
          ) : null}

          <Section title="Name">
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label="Design name"
                size="small"
                value={nameDraft ?? String(screen?.displayName ?? '')}
                onChange={(event) => setNameDraft(event.target.value)}
                sx={{ minWidth: 280 }}
                helperText="What the campaign composer's design picker shows"
              />
              <Button
                size="small"
                disabled={nameDraft === null || !nameDraft.trim() || renaming}
                onClick={() => void handleRename()}
              >
                {renaming ? 'Saving…' : 'Rename'}
              </Button>
            </Stack>
          </Section>

        </Stack>
      </CardDisplay>

      {/*
        What the emails sent from this template did, then who received them:
        each its own boundary, because each card's code arrives after the
        card above it has drawn and must not send it back to a loading state.
       */}
      {Zone ? (
        <Suspense fallback={null}>
          <Zone
            slot={EMAIL_TEMPLATE_REPORT_ZONE.id}
            hostId={hostId}
            screenId={screenId}
            basePath={basePath}
          />
        </Suspense>
      ) : null}
      {Zone ? (
        <Suspense fallback={null}>
          <Zone
            slot={EMAIL_TEMPLATE_RECIPIENTS_ZONE.id}
            hostId={hostId}
            screenId={screenId}
          />
        </Suspense>
      ) : null}

      {/*
       * Last, and its own card — the same order the email's own page uses.
       * The figures are what a reader opens either page for and the frame is
       * the tallest thing on both, so at the top it pushes every number below
       * the fold.
       */}
      <CardDisplay
        header={'Preview'}
        help={previewDocsHelp}
        contentGutterX
        contentGutterY
      >
        <EmailDesignPreview
          hostId={hostId}
          nodes={version?.nodes}
          loading={version === undefined && Boolean(versionId)}
          subject={String(screen?.emailSubject ?? '')}
          preheader={String(screen?.emailPreheader ?? '')}
          emptyMessage={
            'This template has nothing in it yet. Open it in the ' +
            'besigner to build the email.'
          }
        />
      </CardDisplay>
    </Stack>
  )
}
EmailTemplateDetail.displayName = 'EmailTemplateDetail'

export default EmailTemplateDetail
