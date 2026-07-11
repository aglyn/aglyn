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
  Chip,
  MenuItem,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { useFirestoreCollection } from '@aglyn/tenant-feature-instance'

export interface ReviewsModerationCardProps {
  hostId: string
}

/**
 * Review moderation (AGL-324): pending queue with approve/reject and
 * inline seller replies; approved reviews render on the product-reviews
 * block with the aggregate in JSON-LD.
 */
export function ReviewsModerationCard(props: ReviewsModerationCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: reviewDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'reviews'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [filter, setFilter] = useState('pending')
  const [replyFor, setReplyFor] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const reviews = useMemo(
    () =>
      [...(reviewDocs ?? [])]
        .filter((review: any) =>
          filter === 'all' ? true : review.status === filter,
        )
        .sort((a: any, b: any) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0)),
    [reviewDocs, filter],
  )

  const setStatus = (review: any, status: string) =>
    updateDoc(doc(firestore, 'hosts', hostId, 'reviews', review.$id), {
      status,
    })

  return (
    <CardDisplay header={'Review moderation'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        <TextField
          label="Show"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          size="small"
          select
          sx={{ maxWidth: 180 }}
        >
          <MenuItem value="pending">{'Pending'}</MenuItem>
          <MenuItem value="approved">{'Approved'}</MenuItem>
          <MenuItem value="rejected">{'Rejected'}</MenuItem>
          <MenuItem value="all">{'All'}</MenuItem>
        </TextField>
        {reviews.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing to moderate.'}
          </Typography>
        ) : (
          reviews.slice(0, 15).map((review: any) => (
            <Stack key={review.$id} spacing={0.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Rating value={review.rating} size="small" readOnly />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {review.authorName}
                </Typography>
                {review.verified ? (
                  <Chip label="Verified" size="small" color="success" variant="outlined" />
                ) : null}
                <Chip label={review.status} size="small" variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {review.body}
              </Typography>
              <Stack direction="row" spacing={1}>
                {review.status !== 'approved' ? (
                  <Button size="small" onClick={() => setStatus(review, 'approved')}>
                    {'Approve'}
                  </Button>
                ) : null}
                {review.status !== 'rejected' ? (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setStatus(review, 'rejected')}
                  >
                    {'Reject'}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  onClick={() => {
                    setReplyFor(review.$id)
                    setReply(review.reply ?? '')
                  }}
                >
                  {review.reply ? 'Edit reply' : 'Reply'}
                </Button>
              </Stack>
              {replyFor === review.$id ? (
                <Stack direction="row" spacing={1}>
                  <TextField
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    size="small"
                    sx={{ flex: 1 }}
                    placeholder="Public seller reply"
                  />
                  <Button
                    size="small"
                    variant="contained"
                    color="secondary"
                    onClick={async () => {
                      await updateDoc(
                        doc(firestore, 'hosts', hostId, 'reviews', review.$id),
                        { reply: reply.trim().slice(0, 500) || null },
                      )
                      setReplyFor(null)
                      enqueueSnackbar('Reply saved', {
                        variant: 'success',
                        persist: false,
                      })
                    }}
                  >
                    {'Save'}
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          ))
        )}
      </Stack>
    </CardDisplay>
  )
}
ReviewsModerationCard.displayName = 'ReviewsModerationCard'

export default ReviewsModerationCard
