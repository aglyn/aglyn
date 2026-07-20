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
import { parseMarkdownLite } from '@aglyn/aglyn'
import { mdiFileDocumentMultipleOutline } from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { Box, Divider, Link as MuiLink } from '@mui/material'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import HostDisplayNameComponent from '../../../../components/host-display-name.component'
import { useHostId } from '../../../../components/host-id-provider'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import { hasEntitlement } from '../../../../constants/entitlements'
import useCurrentOrg from '../../../../hooks/use-current-org'
import hostNavTabItems from '../../../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../../../hooks/use-host-activity-logger'
import MediaPickerDialog from '../../../../components/media/media-picker-dialog.component'

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')

/**
 * Live markdown-lite preview (AGL-582): the SAME parser the tenant's Entry
 * Body block renders with, so what editors see here is what publishes.
 */
const MarkdownLitePreview = ({ body }: { body: string }) => (
  <>
    {parseMarkdownLite(body).map((block, index) => {
      const inline = (inlines: Aglyn.MarkdownInline[]) =>
        inlines.map((item, i) =>
          item.type === 'bold' ? (
            <strong key={i}>{item.text}</strong>
          ) : item.type === 'italic' ? (
            <em key={i}>{item.text}</em>
          ) : item.type === 'link' ? (
            <MuiLink key={i} href={item.href} target="_blank">
              {item.text}
            </MuiLink>
          ) : (
            <span key={i}>{item.text}</span>
          ),
        )
      if (block.type === 'heading') {
        return (
          <Typography
            key={index}
            variant={block.level === 2 ? 'h5' : 'h6'}
            sx={{ mt: 2 }}
          >
            {inline(block.inlines)}
          </Typography>
        )
      }
      if (block.type === 'image') {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={block.src}
            alt={block.alt}
            style={{ maxWidth: '100%', borderRadius: 8, marginTop: 16 }}
          />
        )
      }
      if (block.type === 'list') {
        return (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>
        )
      }
      return (
        <Typography key={index} variant="body1" sx={{ mt: 1.5 }}>
          {inline(block.inlines)}
        </Typography>
      )
    })}
  </>
)

/**
 * Content collections manager (AGL-81): collections (e.g. Blog) with
 * entries the org serves at /{collectionSlug} and
 * /{collectionSlug}/{entrySlug}.
 */
const HostContent: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)

  const { data: collectionDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'collections'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: hostDoc } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Entry-template screens (AGL-105): assignable per collection.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screenOptions = useMemo(
    () =>
      [...(screenDocs ?? [])]
        .filter((screen: any) => !screen.deletedAt)
        .sort((a: any, b: any) =>
          String(a.displayName ?? '').localeCompare(
            String(b.displayName ?? ''),
          ),
        ),
    [screenDocs],
  )
  // Template screens (AGL-105/551): /{collection} renders through the list
  // template, /{collection}/{entry} through the entry template; both go
  // through the normal published pipeline (theme + shared layout + tokens).
  const handleTemplateChange = useCallback(
    (collectionId: string, kind: 'list' | 'entry') =>
      async (event: { target: { value: string } }) => {
        const value = event.target.value
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'collections', collectionId),
          kind === 'list'
            ? { listScreenId: value || deleteField() }
            : {
                entryScreenId: value || deleteField(),
                // Superseded AGL-105 pointer; clear it so the entry select
                // stays the single source of truth.
                templateScreenId: deleteField(),
              },
        )
        enqueueSnackbar(
          value
            ? `${kind === 'list' ? 'List' : 'Entry'} template assigned — ` +
                'the page renders through that screen'
            : `${kind === 'list' ? 'List' : 'Entry'} template cleared — ` +
                'the built-in themed page renders instead',
          { variant: 'success', persist: false },
        )
      },
    [firestore, hostId, enqueueSnackbar],
  )
  // Live-entry links (AGL-123): custom domain first, subdomain fallback.
  const siteBase = hostDoc?.cname
    ? `https://${hostDoc.cname}`
    : hostDoc?.subdomain
      ? `https://${hostDoc.subdomain}.aglyn.app`
      : null
  const collections = useMemo(
    () => [...(collectionDocs ?? [])].sort((a, b) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    ),
    [collectionDocs],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    collections.find((item) => item.$id === selectedId) ?? collections[0]

  const { data: entryDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected?.$id ?? '-none-',
          'entries',
        ),
        limit(200),
      ),
    [firestore, hostId, selected?.$id],
    { idField: '$id' },
  )
  const entries = useMemo(
    () =>
      [...(entryDocs ?? [])].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    [entryDocs],
  )

  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  const handleCreateCollection = useCallback(async () => {
    const displayName = collectionName.trim()
    if (!displayName) return
    const id = Aglyn.createResourceUid()
    await setDoc(doc(firestore, 'hosts', hostId, 'collections', id), {
      displayName,
      slug: slugify(displayName),
      createdAt: Timestamp.now(),
    })
    setNewCollectionOpen(false)
    setCollectionName('')
    setSelectedId(id)
    enqueueSnackbar(`Collection "${displayName}" created`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Created collection', {
      type: 'content',
      id,
      name: displayName,
    })
  }, [collectionName, firestore, hostId, enqueueSnackbar, logActivity])

  // Entry editor dialog state; null id = creating.
  const [editor, setEditor] = useState<{
    id: string | null
    title: string
    excerpt: string
    body: string
    coverImage: string
    // Entry model v2 (AGL-582): SEO overrides + taxonomy. Tags stay a
    // comma-separated STRING while editing; saved as string[].
    seoTitle: string
    seoDescription: string
    category: string
    tags: string
  } | null>(null)
  // Media picker target: entry cover image or an inline body image.
  const [pickerTarget, setPickerTarget] = useState<'cover' | 'body' | null>(
    null,
  )
  // Markdown toolbar (AGL-582): wraps the CURRENT SELECTION of the body
  // textarea instead of appending at the end.
  const bodyInputRef = useRef<HTMLTextAreaElement | null>(null)
  const applyMarkdown = useCallback(
    (kind: 'bold' | 'italic' | 'heading' | 'link' | 'image') => {
      const input = bodyInputRef.current
      setEditor((prev) => {
        if (!prev) return prev
        const body = prev.body
        const start = input?.selectionStart ?? body.length
        const end = input?.selectionEnd ?? body.length
        const selected = body.slice(start, end)
        // Headings/images are block-level in markdown-lite: they need a
        // blank line before them to parse as their own block.
        const blockPrefix =
          start > 0 && !/\n\n$/.test(body.slice(0, start)) ? '\n\n' : ''
        const insert =
          kind === 'bold'
            ? `**${selected || 'bold text'}**`
            : kind === 'italic'
              ? `*${selected || 'italic text'}*`
              : kind === 'heading'
                ? `${blockPrefix}## ${selected || 'Heading'}`
                : kind === 'link'
                  ? `[${selected || 'link text'}](https://)`
                  : `${blockPrefix}![${selected || 'alt text'}](https://)`
        requestAnimationFrame(() => {
          input?.focus()
          input?.setSelectionRange(start, start + insert.length)
        })
        return {
          ...prev,
          body: body.slice(0, start) + insert + body.slice(end),
        }
      })
    },
    [],
  )
  // AI assist (AGL-130): write or improve the markdown-lite body.
  const { data: aiUser } = useUser()
  const { org } = useCurrentOrg()
  const [aiInstruction, setAiInstruction] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const handleAiConfirm = useCallback(async () => {
    if (aiInstruction == null || !aiInstruction.trim() || aiBusy || !editor) {
      return
    }
    setAiBusy(true)
    try {
      const idToken = await (aiUser as any)?.getIdToken?.()
      const response = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          mode: 'blog',
          title: editor.title,
          excerpt: editor.excerpt,
          text: editor.body,
          instruction: aiInstruction.trim(),
        }),
      })
      const payload = await response.json()
      if (response.status === 501) {
        return void enqueueSnackbar(
          'AI assist is not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok || !payload?.text) {
        return void enqueueSnackbar(payload?.error ?? 'AI request failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      setEditor((prev) => (prev ? { ...prev, body: payload.text } : prev))
      setAiInstruction(null)
      enqueueSnackbar('Body updated — review before saving', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setAiBusy(false)
    }
  }, [aiInstruction, aiBusy, editor, aiUser, enqueueSnackbar])
  // Scheduled publishing (AGL-123): entry id being scheduled + datetime.
  const [scheduler, setScheduler] = useState<{
    entry: any
    at: string
  } | null>(null)

  const handleSaveEntry = useCallback(async () => {
    if (!editor || !selected) return
    const title = editor.title.trim()
    if (!title) return
    const id = editor.id ?? Aglyn.createResourceUid()
    const timestamp = Timestamp.now()
    await setDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'collections',
        selected.$id,
        'entries',
        id,
      ),
      {
        title,
        slug: slugify(title),
        excerpt: editor.excerpt.trim(),
        body: editor.body,
        coverImage: editor.coverImage.trim(),
        // Entry model v2 (AGL-582): SEO overrides + taxonomy.
        seoTitle: editor.seoTitle.trim(),
        seoDescription: editor.seoDescription.trim(),
        category: editor.category.trim(),
        tags: editor.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        ...(editor.id ? {} : { status: 'draft', createdAt: timestamp }),
        updatedAt: timestamp,
      },
      { merge: true },
    )
    setEditor(null)
    enqueueSnackbar(editor.id ? 'Entry saved' : 'Draft created', {
      variant: 'success',
      persist: false,
    })
    logActivity(editor.id ? 'Updated entry' : 'Created entry draft', {
      type: 'content',
      id,
      name: title,
    })
  }, [editor, selected, firestore, hostId, enqueueSnackbar, logActivity])

  const handleTogglePublish = useCallback(
    (entry: any) => async () => {
      if (!selected) return
      const publish = entry.status !== 'published'
      await updateDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected.$id,
          'entries',
          entry.$id,
        ),
        publish
          ? { status: 'published', publishedAt: Timestamp.now() }
          : { status: 'draft', publishedAt: deleteField() },
      )
      enqueueSnackbar(publish ? 'Entry published' : 'Entry unpublished', {
        variant: 'success',
        persist: false,
      })
      logActivity(publish ? 'Published entry' : 'Unpublished entry', {
        type: 'content',
        id: entry.$id,
        name: entry.title,
      })
    },
    [selected, firestore, hostId, enqueueSnackbar, logActivity],
  )

  const handleScheduleEntry = useCallback(async () => {
    if (!scheduler || !selected) return
    const publishAt = new Date(scheduler.at)
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
      return enqueueSnackbar('Pick a future date/time', {
        variant: 'warning',
        persist: false,
      })
    }
    await updateDoc(
      doc(
        firestore,
        'hosts',
        hostId,
        'collections',
        selected.$id,
        'entries',
        scheduler.entry.$id,
      ),
      {
        status: 'scheduled',
        publishAt: Timestamp.fromDate(publishAt),
      },
    )
    enqueueSnackbar(`Scheduled for ${publishAt.toLocaleString()}`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Scheduled entry', {
      type: 'content',
      id: scheduler.entry.$id,
      name: scheduler.entry.title,
    })
    setScheduler(null)
  }, [scheduler, selected, firestore, hostId, enqueueSnackbar, logActivity])

  const handleDeleteEntry = useCallback(
    (entry: any) => async () => {
      if (!selected) return
      const confirmed = await confirm({
        title: 'Delete this entry?',
        description: `"${entry.title}" will be permanently deleted.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await deleteDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          'collections',
          selected.$id,
          'entries',
          entry.$id,
        ),
      )
      enqueueSnackbar('Entry deleted', { variant: 'success', persist: false })
      logActivity('Deleted entry', {
        type: 'content',
        id: entry.$id,
        name: entry.title,
      })
    },
    [selected, confirm, firestore, hostId, enqueueSnackbar, logActivity],
  )

  return (
    <>
      <NextPageTitle screen={'Content'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Content',
            href: buildRoute(Route.HOST_CONTENT, { hostId }),
          },
        ]}
        header={{
          children: 'Content',
          icon: { path: mdiFileDocumentMultipleOutline.path },
        }}
        headerRight={
          <Button
            size="small"
            variant="contained"
            onClick={() => setNewCollectionOpen(true)}
          >
            {'New collection'}
          </Button>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'Collections & Entries'}
            contentGutterX
            contentGutterY
            contentBordered="all"
          >
          {collections.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'Create a collection (e.g. "Blog") to publish entries at ' +
                '/blog and /blog/{entry} on your site.'}
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <TextField
                  select
                  size="small"
                  label="Collection"
                  value={selected?.$id ?? ''}
                  onChange={(event) => setSelectedId(event.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  {collections.map((item) => (
                    <MenuItem key={item.$id} value={item.$id}>
                      {`${item.displayName} (/${item.slug})`}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="List template screen"
                  value={selected?.listScreenId ?? ''}
                  onChange={handleTemplateChange(selected?.$id ?? '', 'list')}
                  sx={{ minWidth: 200 }}
                  helperText={`Screen for /${selected?.slug ?? '…'} — drop a Collection Entries block`}
                >
                  <MenuItem value="">{'Built-in themed list'}</MenuItem>
                  {screenOptions.map((screen: any) => (
                    <MenuItem key={screen.$id} value={screen.$id}>
                      {screen.displayName ?? screen.$id}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Entry template screen"
                  value={
                    selected?.entryScreenId ??
                    selected?.templateScreenId ??
                    ''
                  }
                  onChange={handleTemplateChange(selected?.$id ?? '', 'entry')}
                  sx={{ minWidth: 200 }}
                  helperText={`Screen for /${selected?.slug ?? '…'}/{entry} — use {{entry.title}}, Entry Body`}
                >
                  <MenuItem value="">{'Built-in themed article'}</MenuItem>
                  {screenOptions.map((screen: any) => (
                    <MenuItem key={screen.$id} value={screen.$id}>
                      {screen.displayName ?? screen.$id}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  onClick={() =>
                    setEditor({
                      id: null,
                      title: '',
                      excerpt: '',
                      body: '',
                      coverImage: '',
                      seoTitle: '',
                      seoDescription: '',
                      category: '',
                      tags: '',
                    })
                  }
                >
                  {'New entry'}
                </Button>
              </Stack>
              {entries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {'No entries yet.'}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Title'}</TableCell>
                      <TableCell>{'Status'}</TableCell>
                      <TableCell>{'Updated'}</TableCell>
                      <TableCell align="right">{'Actions'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.$id} hover>
                        <TableCell>
                          {entry.title}
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="span"
                            sx={{ ml: 1 }}
                          >
                            {`/${selected?.slug}/${entry.slug}`}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={
                              entry.status === 'scheduled' && entry.publishAt
                                ? `scheduled · ${entry.publishAt.toDate?.().toLocaleString() ?? ''}`
                                : (entry.status ?? 'draft')
                            }
                            color={
                              entry.status === 'published'
                                ? 'success'
                                : entry.status === 'scheduled'
                                  ? 'info'
                                  : 'default'
                            }
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {entry.updatedAt?.toDate?.().toLocaleString() ?? '--'}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Button
                            size="small"
                            onClick={() =>
                              setEditor({
                                id: entry.$id,
                                title: entry.title ?? '',
                                excerpt: entry.excerpt ?? '',
                                body: entry.body ?? '',
                                coverImage: entry.coverImage ?? '',
                                seoTitle: entry.seoTitle ?? '',
                                seoDescription: entry.seoDescription ?? '',
                                category: entry.category ?? '',
                                tags: Array.isArray(entry.tags)
                                  ? entry.tags.join(', ')
                                  : '',
                              })
                            }
                          >
                            {'Edit'}
                          </Button>
                          <Button
                            size="small"
                            color="secondary"
                            onClick={handleTogglePublish(entry)}
                          >
                            {entry.status === 'published'
                              ? 'Unpublish'
                              : 'Publish'}
                          </Button>
                          <Button
                            size="small"
                            color="secondary"
                            onClick={() => {
                              const initial = new Date(
                                Date.now() + 60 * 60 * 1000,
                              )
                              initial.setMinutes(0, 0, 0)
                              const pad = (value: number) =>
                                String(value).padStart(2, '0')
                              setScheduler({
                                entry,
                                at:
                                  `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-` +
                                  `${pad(initial.getDate())}T${pad(initial.getHours())}:${pad(initial.getMinutes())}`,
                              })
                            }}
                          >
                            {'Schedule'}
                          </Button>
                          {entry.status === 'published' && siteBase ? (
                            <Button
                              size="small"
                              component={MuiLink as any}
                              href={`${siteBase}/${selected?.slug}/${entry.slug}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {'View'}
                            </Button>
                          ) : null}
                          <Button
                            size="small"
                            color="error"
                            onClick={handleDeleteEntry(entry)}
                          >
                            {'Delete'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          )}
          </CardDisplay>
        </Container>
      </DashboardLayout>
      <Dialog
        open={newCollectionOpen}
        onClose={() => setNewCollectionOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New collection'}</DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            size="small"
            fullWidth
            autoFocus
            helperText={
              collectionName.trim()
                ? `Served at /${slugify(collectionName)}`
                : 'e.g. Blog, News, Projects'
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewCollectionOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!collectionName.trim()}
            onClick={handleCreateCollection}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>{editor?.id ? 'Edit entry' : 'New entry'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <TextField
            label="Title"
            value={editor?.title ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText={
              editor?.title.trim()
                ? `/${selected?.slug}/${slugify(editor.title)}`
                : undefined
            }
          />
          <TextField
            label="Excerpt"
            value={editor?.excerpt ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, excerpt: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              label="Cover image URL"
              value={editor?.coverImage ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, coverImage: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flexGrow: 1 }}
            />
            <Button size="small" onClick={() => setPickerTarget('cover')}>
              {'Choose'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Category"
              value={editor?.category ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, category: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flexGrow: 1 }}
              helperText="Single bucket, e.g. Guides"
            />
            <TextField
              label="Tags"
              value={editor?.tags ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, tags: event.target.value } : prev,
                )
              }
              size="small"
              sx={{ flexGrow: 2 }}
              helperText="Comma-separated, e.g. nextjs, seo"
            />
          </Stack>
          <TextField
            label="SEO title"
            value={editor?.seoTitle ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, seoTitle: event.target.value } : prev,
              )
            }
            size="small"
            helperText="Search/social title — falls back to the title"
          />
          <TextField
            label="SEO description"
            value={editor?.seoDescription ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, seoDescription: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
            helperText="Meta description — falls back to the excerpt"
          />
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => applyMarkdown('bold')}>
              {'B'}
            </Button>
            <Button size="small" onClick={() => applyMarkdown('italic')}>
              {'I'}
            </Button>
            <Button size="small" onClick={() => applyMarkdown('heading')}>
              {'H2'}
            </Button>
            <Button size="small" onClick={() => applyMarkdown('link')}>
              {'Link'}
            </Button>
            <Button size="small" onClick={() => applyMarkdown('image')}>
              {'Image'}
            </Button>
            <Button size="small" onClick={() => setPickerTarget('body')}>
              {'Insert image'}
            </Button>
            <Divider orientation="vertical" flexItem />
            <Button
              size="small"
              color="secondary"
              onClick={() => {
                if (!hasEntitlement('ai-assist', org)) {
                  return void enqueueSnackbar(
                    'AI assist requires a Pro plan — see Billing to upgrade',
                    { variant: 'warning', persist: false },
                  )
                }
                setAiInstruction('')
              }}
            >
              {editor?.body?.trim() ? 'Improve with AI' : 'Write with AI'}
            </Button>
          </Stack>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: 'stretch' }}
          >
            <TextField
              label="Body"
              value={editor?.body ?? ''}
              onChange={(event) =>
                setEditor((prev) =>
                  prev ? { ...prev, body: event.target.value } : prev,
                )
              }
              size="small"
              multiline
              minRows={12}
              inputRef={bodyInputRef}
              sx={{ flex: 1, minWidth: 0 }}
              helperText="Markdown-lite: **bold**, *italic*, ## headings, - lists, [links](https:// or /page), ![images](https://)."
            />
            {/* Live preview (AGL-582): same parser the tenant renders with. */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                maxHeight: 420,
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                px: 2,
                pb: 2,
              }}
            >
              <Typography
                variant="overline"
                color="text.secondary"
                component="div"
                sx={{ pt: 1 }}
              >
                {'Preview'}
              </Typography>
              {editor?.body?.trim() ? (
                <MarkdownLitePreview body={editor.body} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'Start writing to see the preview.'}
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!editor?.title.trim()}
            onClick={handleSaveEntry}
          >
            {editor?.id ? 'Save' : 'Create draft'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={aiInstruction != null}
        onClose={() => (aiBusy ? null : setAiInstruction(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {editor?.body?.trim() ? 'Improve with AI' : 'Write with AI'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {editor?.body?.trim()
              ? 'Describe how the body should change — tone, structure, length.'
              : 'Describe the post — the title and excerpt are included automatically.'}
          </Typography>
          <TextField
            label="Instruction"
            placeholder={
              editor?.body?.trim()
                ? 'e.g. Tighten it up and add a closing call to action'
                : 'e.g. A 500-word how-to with three practical tips'
            }
            value={aiInstruction ?? ''}
            onChange={(event) => setAiInstruction(event.target.value)}
            size="small"
            autoFocus
            multiline
            minRows={2}
            disabled={aiBusy}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={aiBusy} onClick={() => setAiInstruction(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!aiInstruction?.trim() || aiBusy}
            onClick={handleAiConfirm}
          >
            {aiBusy ? 'Working…' : editor?.body?.trim() ? 'Improve' : 'Write'}
          </Button>
        </DialogActions>
      </Dialog>
      <MediaPickerDialog
        hostId={hostId}
        open={pickerTarget != null}
        onClose={() => setPickerTarget(null)}
        onPick={(media) => {
          const url = (media as any).url as string | undefined
          if (url) {
            setEditor((prev) =>
              prev
                ? pickerTarget === 'cover'
                  ? { ...prev, coverImage: url }
                  : {
                      ...prev,
                      body: `${prev.body}\n\n![${(media as any).alt ?? (media as any).fileName ?? ''}](${url})`,
                    }
                : prev,
            )
          }
          setPickerTarget(null)
        }}
      />
      <Dialog
        open={Boolean(scheduler)}
        onClose={() => setScheduler(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Schedule entry'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'The entry goes live once the time passes (applied on the ' +
              'next site refresh).'}
          </Typography>
          <TextField
            size="small"
            type="datetime-local"
            label="Publish at"
            value={scheduler?.at ?? ''}
            onChange={(event) =>
              setScheduler((prev) =>
                prev ? { ...prev, at: event.target.value } : prev,
              )
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduler(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!scheduler?.at}
            onClick={handleScheduleEntry}
          >
            {'Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
HostContent.displayName = 'Page:HostContent'

export default HostContent
