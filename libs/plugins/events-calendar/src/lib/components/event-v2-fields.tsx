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

import { createResourceUid } from '@aglyn/aglyn'
import { pluginEntityPicker } from '@aglyn/aglyn/plugin-manager/plugin-entity-pickers'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  EVENT_CATEGORIES_COLLECTION,
  EVENT_CATEGORY_MAX,
  EVENT_CATEGORY_NAME_MAX_LENGTH,
  EVENT_TICKET_LABEL_MAX_LENGTH,
  eventCategoryColorOf,
  eventCategoryDefaultColor,
  eventCategoryOf,
  eventTicketDefaultLabel,
  sortEventCategories,
  type EventCategory,
} from '../model/event-categories'
import type { RepeatDraft, TicketDraft } from '../model/event-editor-draft'
import { isEventDayKey } from '../model/event-recurrence'

/**
 * THE EVENTS PAGE'S CALENDAR V2 PARTS (AGL-4252): the categories card, and
 * the editor's categories, "Repeats" and "Tickets" boxes. Shown only where
 * `release_events_calendar_v2` is on for the workspace (or to staff).
 */

/** The site's categories, live, in chip order. */
export function useEventCategories(hostId: string): EventCategory[] {
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<
    Record<string, unknown> & { $id: string }
  >(
    () =>
      hostId
        ? query(
            collection(firestore, 'hosts', hostId, EVENT_CATEGORIES_COLLECTION),
            limit(EVENT_CATEGORY_MAX + 10),
          )
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )
  return useMemo(
    () =>
      sortEventCategories(
        (data ?? [])
          .map((row) => eventCategoryOf(row.$id, row))
          .filter((one): one is EventCategory => Boolean(one)),
      ),
    [data],
  )
}

/** The categories card: name, color and order, with add, edit and delete. */
export function EventCategoriesCard(props: {
  hostId: string
  categories: EventCategory[]
}) {
  const { hostId, categories } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [draft, setDraft] = useState<{
    id: string | null
    name: string
    color: string
  } | null>(null)

  const save = async () => {
    if (!draft) return
    const name = draft.name.trim().slice(0, EVENT_CATEGORY_NAME_MAX_LENGTH)
    const color = eventCategoryColorOf(draft.color)
    if (!name || !color) return
    const id = draft.id ?? createResourceUid()
    const order = draft.id
      ? (categories.find((one) => one.$id === draft.id)?.order ?? 0)
      : Math.max(-1, ...categories.map((one) => one.order)) + 1
    try {
      await setDoc(
        doc(firestore, 'hosts', hostId, EVENT_CATEGORIES_COLLECTION, id),
        { name, color, order },
        { merge: true },
      )
      setDraft(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('The category was not saved', { variant: 'error' })
    }
  }

  const move = async (category: EventCategory, direction: -1 | 1) => {
    const index = categories.findIndex((one) => one.$id === category.$id)
    const other = categories[index + direction]
    if (!other) return
    await Promise.all([
      setDoc(
        doc(
          firestore,
          'hosts',
          hostId,
          EVENT_CATEGORIES_COLLECTION,
          category.$id,
        ),
        {
          order:
            other.order === category.order
              ? category.order + direction
              : other.order,
        },
        { merge: true },
      ),
      setDoc(
        doc(firestore, 'hosts', hostId, EVENT_CATEGORIES_COLLECTION, other.$id),
        { order: category.order },
        { merge: true },
      ),
    ])
  }

  const remove = async (category: EventCategory) => {
    const confirmed = await confirm({
      title: 'Delete this category?',
      description: `"${category.name}" comes off every event in it. The events stay.`,
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
        EVENT_CATEGORIES_COLLECTION,
        category.$id,
      ),
    )
  }

  return (
    <CardDisplay
      header={'Categories'}
      HeaderProps={{
        action:
          categories.length < EVENT_CATEGORY_MAX ? (
            <Button
              size="small"
              onClick={() =>
                setDraft({
                  id: null,
                  name: '',
                  color: eventCategoryDefaultColor(categories.length),
                })
              }
            >
              {'Add category'}
            </Button>
          ) : undefined,
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        {categories.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {
              'Group events into categories, such as Training or Kids camp. Visitors filter the Calendar by them, and each wears its own color.'
            }
          </Typography>
        ) : (
          categories.map((category, index) => (
            <Stack
              key={category.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  bgcolor: category.color,
                  flexShrink: 0,
                }}
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {category.name}
              </Typography>
              <Button
                size="small"
                aria-label={`Move ${category.name} up`}
                disabled={index === 0}
                onClick={() => void move(category, -1)}
              >
                {'↑'}
              </Button>
              <Button
                size="small"
                aria-label={`Move ${category.name} down`}
                disabled={index === categories.length - 1}
                onClick={() => void move(category, 1)}
              >
                {'↓'}
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: category.$id,
                    name: category.name,
                    color: category.color,
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => void remove(category)}
              >
                {'Delete'}
              </Button>
            </Stack>
          ))
        )}
      </Stack>
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {draft?.id ? 'Edit category' : 'Add category'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? {
                      ...prev,
                      name: event.target.value.slice(
                        0,
                        EVENT_CATEGORY_NAME_MAX_LENGTH,
                      ),
                    }
                  : prev,
              )
            }
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              label="Color"
              type="color"
              size="small"
              value={draft?.color ?? eventCategoryDefaultColor(0)}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, color: event.target.value } : prev,
                )
              }
              sx={{ width: 120 }}
            />
            <Typography variant="body2" color="text.secondary">
              {'The chip and the dot on each of its events.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={!draft?.name.trim()}
            onClick={() => void save()}
          >
            {'Save category'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

/** The editor's category chips: tap to put the event in or take it out. */
export function EventCategoryPicker(props: {
  categories: EventCategory[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const { categories, value, onChange } = props
  if (!categories.length) return null
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {'Categories'}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        {categories.map((category) => {
          const on = value.includes(category.$id)
          return (
            <Chip
              key={category.$id}
              label={category.name}
              size="small"
              aria-pressed={on}
              variant={on ? 'filled' : 'outlined'}
              onClick={() =>
                onChange(
                  on
                    ? value.filter((id) => id !== category.$id)
                    : [...value, category.$id],
                )
              }
              sx={
                on
                  ? {
                      bgcolor: category.color,
                      color: (theme) => theme.palette.getContrastText(category.color),
                      '&:hover': { bgcolor: category.color },
                    }
                  : { borderColor: category.color }
              }
            />
          )
        })}
      </Stack>
    </Stack>
  )
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** "Repeats": how often, which days, when it ends, and the days it skips. */
export function EventRepeatFields(props: {
  value: RepeatDraft
  onChange: (next: RepeatDraft) => void
  problem: string | null
}) {
  const { value, onChange, problem } = props
  const [skip, setSkip] = useState('')
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...value, ...patch })
  const unit =
    value.freq === 'daily'
      ? 'days'
      : value.freq === 'weekly'
        ? 'weeks'
        : 'months'
  return (
    <Stack spacing={1.5}>
      <TextField
        select
        label="Repeats"
        size="small"
        value={value.freq}
        onChange={(event) =>
          set({ freq: event.target.value as RepeatDraft['freq'] })
        }
      >
        <MenuItem value="none">{'Does not repeat'}</MenuItem>
        <MenuItem value="daily">{'Daily'}</MenuItem>
        <MenuItem value="weekly">{'Weekly'}</MenuItem>
        <MenuItem value="monthly">{'Monthly, on the same date'}</MenuItem>
      </TextField>
      {value.freq === 'none' ? null : (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              label="Every"
              size="small"
              value={value.interval}
              onChange={(event) =>
                set({
                  interval: event.target.value.replace(/\D/g, '').slice(0, 2),
                })
              }
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
              sx={{ width: 90 }}
            />
            <Typography variant="body2">{unit}</Typography>
          </Stack>
          {value.freq === 'weekly' ? (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                {'On'}
              </Typography>
              <ToggleButtonGroup
                size="small"
                value={value.weekdays}
                onChange={(_, next: number[]) =>
                  set({ weekdays: [...next].sort((a, b) => a - b) })
                }
                aria-label="Days of the week"
              >
                {WEEKDAY_LETTERS.map((letter, day) => (
                  <ToggleButton
                    key={day}
                    value={day}
                    aria-label={WEEKDAY_NAMES[day]}
                    sx={{ px: 1.25 }}
                  >
                    {letter}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary">
                {'None chosen repeats on the day it starts.'}
              </Typography>
            </Stack>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              select
              label="Ends"
              size="small"
              value={value.ends}
              onChange={(event) =>
                set({ ends: event.target.value as RepeatDraft['ends'] })
              }
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="never">{'Never'}</MenuItem>
              <MenuItem value="on">{'On a date'}</MenuItem>
              <MenuItem value="after">{'After a number of times'}</MenuItem>
            </TextField>
            {value.ends === 'on' ? (
              <TextField
                label="Last day"
                type="date"
                size="small"
                value={value.untilDayKey}
                onChange={(event) => set({ untilDayKey: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            ) : null}
            {value.ends === 'after' ? (
              <TextField
                label="Times"
                size="small"
                value={value.count}
                onChange={(event) =>
                  set({
                    count: event.target.value.replace(/\D/g, '').slice(0, 3),
                  })
                }
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                sx={{ width: 100 }}
              />
            ) : null}
          </Stack>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                label="Skip a date"
                type="date"
                size="small"
                value={skip}
                onChange={(event) => setSkip(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button
                size="small"
                disabled={
                  !isEventDayKey(skip) || value.exceptDayKeys.includes(skip)
                }
                onClick={() => {
                  set({ exceptDayKeys: [...value.exceptDayKeys, skip].sort() })
                  setSkip('')
                }}
              >
                {'Skip'}
              </Button>
            </Stack>
            {value.exceptDayKeys.length ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', rowGap: 1 }}
              >
                {value.exceptDayKeys.map((day) => (
                  <Chip
                    key={day}
                    size="small"
                    label={new Date(`${day}T12:00:00Z`).toLocaleDateString(
                      'en-US',
                      {
                        timeZone: 'UTC',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      },
                    )}
                    onDelete={() =>
                      set({
                        exceptDayKeys: value.exceptDayKeys.filter(
                          (one) => one !== day,
                        ),
                      })
                    }
                  />
                ))}
              </Stack>
            ) : null}
          </Stack>
          {problem ? (
            <Typography variant="body2" color="error" role="alert">
              {problem}
            </Typography>
          ) : null}
        </>
      )}
    </Stack>
  )
}

/**
 * The records a ticket may name, read through the kind's picker
 * declaration (`plugin-entity-pickers`), so this plugin names no other
 * plugin's collection: `products` for a store product, `services` for a
 * bookings service. A kind no enabled plugin declares lists nothing.
 */
function useTicketOptions(
  hostId: string,
  kind: TicketDraft['kind'],
): Array<{ id: string; name: string }> | null {
  const firestore = useFirestore()
  const declaration = kind
    ? pluginEntityPicker(kind === 'product' ? 'products' : 'services')
    : null
  const { data, status } = useFirestoreCollection<
    Record<string, unknown> & { $id: string }
  >(
    () =>
      hostId && declaration && declaration.scope === 'host'
        ? query(
            collection(firestore, 'hosts', hostId, declaration.collection),
            limit(300),
          )
        : null,
    [firestore, hostId, declaration?.collection],
    { idField: '$id' },
  )
  return useMemo(() => {
    if (!declaration) return []
    if (status === 'loading' && !data) return null
    return (data ?? [])
      .filter(
        (row) =>
          !row['deletedAt'] &&
          row['status'] !== 'draft' &&
          row['status'] !== 'archived',
      )
      .filter((row) =>
        (declaration.where ?? []).every(
          (clause) => row[clause.field] === clause.equals,
        ),
      )
      .map((row) => ({
        id: row.$id,
        name: String(row[declaration.nameField] ?? row['name'] ?? row.$id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, status, declaration])
}

/** "Tickets": a store product put in the cart, or a bookings service booked. */
export function EventTicketFields(props: {
  hostId: string
  value: TicketDraft
  onChange: (next: TicketDraft) => void
}) {
  const { hostId, value, onChange } = props
  const options = useTicketOptions(hostId, value.kind)
  const productsDeclared = Boolean(pluginEntityPicker('products'))
  const servicesDeclared = Boolean(pluginEntityPicker('services'))
  if (!productsDeclared && !servicesDeclared) return null
  return (
    <Stack spacing={1.5}>
      <TextField
        select
        label="Tickets"
        size="small"
        value={value.kind}
        onChange={(event) =>
          onChange({
            kind: event.target.value as TicketDraft['kind'],
            id: '',
            label: value.label,
          })
        }
        helperText={
          value.kind === 'product'
            ? 'Get tickets puts the product in the cart. A product that asks for a use day gets the event’s date.'
            : value.kind === 'service'
              ? 'Book opens your booking page on the service.'
              : 'A button on the event that sells a place.'
        }
      >
        <MenuItem value="">{'No tickets'}</MenuItem>
        {productsDeclared ? (
          <MenuItem value="product">{'A product from your store'}</MenuItem>
        ) : null}
        {servicesDeclared ? (
          <MenuItem value="service">{'A booking service'}</MenuItem>
        ) : null}
      </TextField>
      {value.kind ? (
        <>
          <TextField
            select
            label={value.kind === 'product' ? 'Product' : 'Service'}
            size="small"
            value={
              options?.some((option) => option.id === value.id) ? value.id : ''
            }
            onChange={(event) => onChange({ ...value, id: event.target.value })}
            disabled={!options}
            helperText={
              options && !options.length
                ? `No ${value.kind === 'product' ? 'products' : 'services'} yet.`
                : undefined
            }
          >
            {(options ?? []).map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Button label"
            size="small"
            placeholder={eventTicketDefaultLabel(value.kind)}
            value={value.label}
            onChange={(event) =>
              onChange({
                ...value,
                label: event.target.value.slice(
                  0,
                  EVENT_TICKET_LABEL_MAX_LENGTH,
                ),
              })
            }
          />
        </>
      ) : null}
    </Stack>
  )
}
