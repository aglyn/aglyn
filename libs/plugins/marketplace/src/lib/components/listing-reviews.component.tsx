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
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  Divider,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { pluginDocsHelp } from '@aglyn/aglyn'
import ReportTarget from './report-target.component'

/**
 * How many review documents this card reads.
 *
 * A CEILING, not a page size. Three things below are computed over the whole
 * set — the hidden-review filter, the newest-first sort, and finding the
 * reader's OWN review to seed the form — so a server page would be a page of
 * candidates and a reader whose review sat past the first ten would be shown
 * an empty form over a review they had already written.
 */
const REVIEW_CEILING = 200

/**
 * Ratings and comments on a listing (AGL-655).
 *
 * Reads the subcollection directly — it is public-read, so there is no
 * value in proxying it through an API. Writes go through
 * `/api/marketplace/reviews`, which owns every rule that matters: only
 * accounts that installed the listing may rate it, the publishing org
 * cannot review itself, and the aggregates it maintains are frozen from
 * client writes.
 *
 * The star input is offered to everyone and refused server-side rather than
 * hidden, because "you must install this to rate it" is worth saying out
 * loud — a control that silently does nothing teaches nothing.
 */
export function ListingReviews({
  listingId,
  listing,
}: {
  listingId: string
  listing: Record<string, any> | undefined
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const uid = (user as any)?.uid as string | undefined
  // Rating (not commenting) requires a verified email (AGL-865). We can't see
  // the install pins from here, so the "installed" half is still enforced
  // server-side; the email half we can reflect in the control's state.
  const emailVerified = Boolean((user as any)?.emailVerified)

  const { data: reviewDocs } = useFirestoreCollection<any>(
    /*
     * ORDERED AND CEILINGED, with a probe (AGL-2501).
     *
     * `limit(100)` alone is answered in DOCUMENT-ID order, and a review's
     * document id is its author's uid — so the hundred were a pseudo-random
     * hundred of the reviewers, and on a popular listing the reviews past
     * them were not merely unrendered but unreachable, because nothing drew
     * them and no control asked for more.
     *
     * Ordering on the document NAME changes which rows come back only in the
     * sense that the walk is now total: every reviewer is reachable by
     * paging. It is not chronological and nothing here claims it is — the
     * sort below puts the newest first, which it may do because it holds the
     * whole ceiling rather than a slice of it.
     *
     * `orderBy('updatedAtMs')` would have been the tempting fix and is the
     * dangerous one: it matches only documents that HAVE the field, so a
     * review written before that field existed would vanish from a listing's
     * page rather than sort oddly on it.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'marketplaceListings', listingId, 'reviews'),
        REVIEW_CEILING,
      ),
    [firestore, listingId],
    { idField: '$id' },
  )
  const { rows: readReviews, truncated: reviewsTruncated } = ceilingedWindow<any>(
    reviewDocs,
    REVIEW_CEILING,
  )

  const reviews = useMemo(
    () =>
      [...readReviews]
        .filter((entry: any) => !entry.hidden)
        .sort((a: any, b: any) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewDocs],
  )
  const mine = useMemo(
    () => reviews.find((entry: any) => entry.$id === uid),
    [reviews, uid],
  )

  /*
   * The page is a SLICE of what the card already holds, for the three reasons
   * the ceiling exists: `hidden` is filtered after reading, the order on
   * screen is not the order the query walks, and `mine` seeds the form above
   * from anywhere in the set.
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleReviews = useMemo(
    () => reviews.slice(page * pageSize, page * pageSize + pageSize),
    [reviews, page, pageSize],
  )
  /*
   * A new listing starts at page one. Page four of a listing with two pages
   * does not exist, and an out-of-range page renders as an empty list with
   * nothing saying why — which reads as the reviews having gone.
   */
  useEffect(() => {
    setPage(0)
  }, [listingId])

  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setRating(mine?.rating ?? null)
    setComment(mine?.comment ?? '')
  }, [mine])

  const submit = useCallback(async () => {
    if (busy || (!rating && !comment.trim())) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ listingId, rating, comment: comment.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // 403 here is usually "you have not installed this" — actionable,
        // so it reads as guidance rather than an error.
        return void enqueueSnackbar(payload?.error ?? 'Could not post that', {
          variant: response.status === 403 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(mine ? 'Updated your review' : 'Thanks for the review', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not post that', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, rating, comment, user, listingId, mine, enqueueSnackbar])

  const remove = useCallback(async () => {
    if (busy || !mine) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      await fetch('/api/marketplace/reviews', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ listingId }),
      })
      setRating(null)
      setComment('')
      enqueueSnackbar('Removed your review', {
        variant: 'success',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, mine, user, listingId, enqueueSnackbar])

  const average = Number(listing?.ratingAverage ?? 0)
  const ratingCount = Number(listing?.ratingCount ?? 0)

  return (
    <CardDisplay
      header={'Ratings & comments'}
      help={pluginDocsHelp('installYourFirstPlugin', {
        anchor: '#step-3-reviews',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {ratingCount ? (
            <>
              <Rating value={average} precision={0.1} size="small" readOnly />
              <Typography variant="body2" color="text.secondary">
                {`${average} · ${ratingCount} rating${
                  ratingCount === 1 ? '' : 's'
                }`}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'No ratings yet.'}
            </Typography>
          )}
        </Stack>

        {uid ? (
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {mine ? 'Your review' : 'Leave a review'}
            </Typography>
            {/* Rating and comment are distinct affordances (AGL-865): a rating
                is gated on a verified email + an install and moves the score;
                a comment is open to anyone signed in. */}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" sx={{ minWidth: 56 }}>
                {'Rating'}
              </Typography>
              <Rating
                value={rating}
                size="small"
                onChange={(_event, value) => setRating(value)}
                disabled={busy || !emailVerified}
              />
              <Typography variant="caption" color="text.secondary">
                {emailVerified
                  ? 'Requires having installed this'
                  : 'Verify your email to rate'}
              </Typography>
            </Stack>
            <TextField
              size="small"
              label="Comment"
              placeholder="Share how it worked out, or ask a question — anyone can comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              disabled={busy}
              multiline
              minRows={2}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={busy || (!rating && !comment.trim())}
                onClick={() => void submit()}
              >
                {busy ? 'Posting…' : mine ? 'Update' : 'Post'}
              </Button>
              {mine ? (
                <Button size="small" disabled={busy} onClick={() => void remove()}>
                  {'Remove'}
                </Button>
              ) : null}
            </Stack>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Sign in to leave a rating or comment.'}
          </Typography>
        )}

        {reviews.length ? (
          <>
            <Divider />
            <Stack spacing={2}>
              {visibleReviews.map((review: any) => {
                const name = String(review.displayName ?? 'Someone')
                return (
                  <Stack
                    key={review.$id}
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'flex-start' }}
                  >
                    <Avatar
                      sx={{ width: 32, height: 32, fontSize: 14 }}
                    >
                      {name.trim().charAt(0).toUpperCase() || '?'}
                    </Avatar>
                    <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {name}
                        </Typography>
                        {/* Server-set, so the badge means something: it is the
                            difference between "used it" and "walked past it". */}
                        {review.verifiedInstaller ? (
                          <Chip
                            size="small"
                            label="Installed"
                            color="primary"
                          />
                        ) : null}
                        {review.updatedAtMs ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                          >
                            {new Date(review.updatedAtMs).toLocaleDateString()}
                          </Typography>
                        ) : null}
                      </Stack>
                      {review.rating ? (
                        <Rating value={review.rating} size="small" readOnly />
                      ) : null}
                      {review.comment ? (
                        <Typography variant="body2" color="text.secondary">
                          {review.comment}
                        </Typography>
                      ) : null}
                      {/* Not on your OWN review: the queue is for things a
                          stranger wrote, and "report yourself" is noise a
                          staff member then has to read. Editing yours is
                          already the control above. */}
                      {uid && review.$id !== uid ? (
                        <ReportTarget
                          listingId={listingId}
                          reviewUid={review.$id}
                          label={`this review by ${name}`}
                        />
                      ) : null}
                    </Stack>
                  </Stack>
                )
              })}
            </Stack>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={visibleReviews.length}
              // The reviews this card HOLDS, after the hidden ones are
              // dropped — a slice of rows already read, so the total is
              // known exactly for the window. The alert below is what says
              // when the window itself is short of the listing.
              count={reviews.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
            {reviewsTruncated ? (
              <Alert severity="info">
                {`Showing ${REVIEW_CEILING} reviews, ordered by author. This ` +
                  'listing has more, and the rating summary above counts all ' +
                  'of them.'}
              </Alert>
            ) : null}
          </>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

ListingReviews.displayName = 'ListingReviews'

export default ListingReviews
