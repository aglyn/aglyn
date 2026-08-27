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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import {
  useFirestoreCollection,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import { EntitlementGatedCard } from './entitlement-gate.component'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface MemberPostsCardProps {
  hostId: string
}

/**
 * Member updates (AGL-316): posts for entitled subscribers, published
 * through a manager-gated API that can also email the audience. The
 * member-feed block renders them on the site.
 *
 * Gated on `contentGating` since AGL-2080, and this is the one of the five
 * that failed OPEN. `server/gate.ts:48` (`hostHasContentGating`) is what
 * decides whether `membership-content.ts`, `member-feed.ts` and `stream.ts`
 * withhold anything; without the entitlement it withholds nothing. So an
 * unentitled operator could mark a post members-only, see it accepted, and
 * have the renderer serve it to the public — believing content was protected
 * while it was not. A refusal the operator can see is the fix.
 */

/** Posts shown before "Load more". */
const POSTS_PAGE_SIZE = 8

const memberPostsHelp = pluginDocsHelp('membersOnly', {
  anchor: '#manage-your-members',
})

export function MemberPostsCard(props: MemberPostsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  /*
   * Ordered by the SERVER, and a growing window rather than a fixed read.
   *
   * This was `limit(50)` with no `orderBy`, rendering `.slice(0, 8)`. A
   * Firestore query with a limit and no ordering returns DOCUMENT-ID order,
   * and posts are created with `.add()`, so those fifty were a pseudo-random
   * sample of the feed — the client sort below then ordered the sample and
   * showed eight of it, which looks newest-first and is not. Past fifty
   * posts, one written this morning could simply never appear.
   */
  const {
    rows: posts,
    hasMore: hasMorePosts,
    loadMore: loadMorePosts,
  } = usePagedCollection<any>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'memberPosts'),
        orderBy('createdAtMs', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id', pageSize: POSTS_PAGE_SIZE },
  )
  const { data: productDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'products'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [draft, setDraft] = useState<{
    title: string
    body: string
    productId: string
    emailSubscribers: boolean
    busy?: boolean
  } | null>(null)

  const handlePublish = useCallback(async () => {
    if (!draft?.title.trim()) return
    setDraft((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/commerce/member-post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, ...draft }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        payload.emailed
          ? `Published — emailed ${payload.emailed} subscribers`
          : 'Published',
        { variant: 'success', persist: false },
      )
      setDraft(null)
    } finally {
      setDraft((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [draft, user, hostId, enqueueSnackbar])

  return (
    <EntitlementGatedCard
      help={memberPostsHelp}
      hostId={hostId}
      feature="contentGating"
      header={'Member updates'}
      upsell={
        'Memberships and gated content keep posts, pages and video behind ' +
        'a subscription, and publish updates to the members entitled to ' +
        'them.'
      }
    >
    <CardDisplay
      header={'Member updates'}
      help={memberPostsHelp}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {posts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Post updates only your subscribers can see (and optionally ' +
              'email them). Add a Member feed block to a members screen.'}
          </Typography>
        ) : (
          posts.map((post: any) => (
            <Stack
              key={post.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {post.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(post.createdAtMs ?? 0).toLocaleDateString()}
                </Typography>
              </Stack>
              <Button
                size="small"
                color="error"
                onClick={() =>
                  deleteDoc(
                    doc(firestore, 'hosts', hostId, 'memberPosts', post.$id),
                  )
                }
              >
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
        {hasMorePosts ? (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={loadMorePosts}
          >
            {'Load more'}
          </Button>
        ) : null}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setDraft({
              title: '',
              body: '',
              productId: '',
              emailSubscribers: true,
            })
          }
        >
          {'New update'}
        </Button>
      </Stack>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{'New member update'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Title"
            value={draft?.title ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, title: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Body"
            value={draft?.body ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, body: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={4}
          />
          <TextField
            label="Audience"
            value={draft?.productId ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, productId: event.target.value } : prev,
              )
            }
            size="small"
            select
          >
            <MenuItem value="">{'All live subscribers'}</MenuItem>
            {(productDocs ?? [])
              .filter((product: any) => product.subscription)
              .map((product: any) => (
                <MenuItem key={product.$id} value={product.$id}>
                  {`Subscribers of ${product.name}`}
                </MenuItem>
              ))}
          </TextField>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={draft?.emailSubscribers ?? true}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, emailSubscribers: event.target.checked }
                      : prev,
                  )
                }
              />
            }
            label="Email subscribers"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!draft?.title.trim() || draft?.busy}
            onClick={handlePublish}
          >
            {'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
    </EntitlementGatedCard>
  )
}
MemberPostsCard.displayName = 'MemberPostsCard'

export default MemberPostsCard
