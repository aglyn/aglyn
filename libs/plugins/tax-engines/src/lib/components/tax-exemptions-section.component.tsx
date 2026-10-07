'use client'

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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { TAX_ENGINES_API_ROUTES } from '../constants/api-routes'
import {
  TAX_EXEMPTION_TYPE_LABELS,
  TAX_EXEMPTION_TYPES,
  type TaxExemptionType,
  type TaxExemptionView,
} from '../model/tax-engines'
import { useTaxEnginesFetch } from './tax-engines-api'

interface ExemptionForm {
  email: string
  name: string
  type: TaxExemptionType
  certificateNumber: string
  regions: string
}

const EMPTY: ExemptionForm = { email: '', name: '', type: 'wholesale', certificateNumber: '', regions: '' }

/**
 * Customers who pay no tax (AGL-3631): a reseller, a school, a charity. A
 * sale to one of them — matched by the email they check out or are rung up
 * with — goes to the tax service with their exemption, and the service
 * applies it. On AvaTax, a certificate the merchant keeps in Avalara's own
 * exemption manager applies by the same email, as the customer code.
 */
export function TaxExemptionsSection(props: { hostId: string }) {
  const { hostId } = props
  const request = useTaxEnginesFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [rows, setRows] = useState<TaxExemptionView[] | null>(null)
  const [editing, setEditing] = useState<ExemptionForm | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const answer = await request<{ exemptions: TaxExemptionView[] }>(TAX_ENGINES_API_ROUTES.exemptions, {
        query: { hostId },
      })
      setRows(answer.exemptions)
    } catch (cause) {
      setRows([])
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    }
  }, [enqueueSnackbar, hostId, request])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!editing) return
    setBusy(true)
    try {
      await request(TAX_ENGINES_API_ROUTES.exemptions, {
        body: {
          hostId,
          email: editing.email,
          name: editing.name,
          type: editing.type,
          certificateNumber: editing.certificateNumber,
          regions: editing.regions
            .split(/[\s,]+/)
            .map((region) => region.trim())
            .filter(Boolean),
        },
      })
      setEditing(null)
      await load()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (row: TaxExemptionView) => {
    try {
      await request(TAX_ENGINES_API_ROUTES.exemptionsDelete, { body: { hostId, id: row.id } })
      await load()
    } catch (cause) {
      enqueueSnackbar((cause as Error).message, { variant: 'error', persist: false })
    }
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{'Exempt customers'}</Typography>
        <Button size="small" onClick={() => setEditing(EMPTY)}>
          {'Add exempt customer'}
        </Button>
      </Stack>
      {rows && rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No exempt customers. Add one to send their exemption with every sale to them.'}
        </Typography>
      ) : null}
      {rows && rows.length > 0 ? (
        <List dense disablePadding>
          {rows.map((row) => (
            <ListItem
              key={row.id}
              disableGutters
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <Button
                    size="small"
                    onClick={() =>
                      setEditing({
                        email: row.email,
                        name: row.name ?? '',
                        type: row.type,
                        certificateNumber: row.certificateNumber ?? '',
                        regions: row.regions.join(', '),
                      })
                    }
                  >
                    {'Edit'}
                  </Button>
                  <Button size="small" color="error" onClick={() => handleRemove(row)}>
                    {'Remove'}
                  </Button>
                </Stack>
              }
            >
              <ListItemText
                primary={row.name ? `${row.name} · ${row.email}` : row.email}
                secondary={[
                  TAX_EXEMPTION_TYPE_LABELS[row.type],
                  row.certificateNumber ? `Certificate ${row.certificateNumber}` : null,
                  row.regions.length > 0 ? `In ${row.regions.join(', ')}` : 'Everywhere',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      ) : null}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{'Exempt customer'}</DialogTitle>
        <DialogContent>
          {editing ? (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField
                label="Email"
                value={editing.email}
                onChange={(event) => setEditing({ ...editing, email: event.target.value })}
                helperText="The address they check out with"
              />
              <TextField
                label="Name"
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
              <TextField
                select
                label="Reason"
                value={editing.type}
                onChange={(event) => setEditing({ ...editing, type: event.target.value as TaxExemptionType })}
              >
                {TAX_EXEMPTION_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {TAX_EXEMPTION_TYPE_LABELS[type]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Certificate number"
                value={editing.certificateNumber}
                onChange={(event) => setEditing({ ...editing, certificateNumber: event.target.value })}
              />
              <TextField
                label="States"
                value={editing.regions}
                onChange={(event) => setEditing({ ...editing, regions: event.target.value.toUpperCase() })}
                placeholder="TX, CA"
                helperText="Where the certificate applies. Leave blank for everywhere."
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{'Cancel'}</Button>
          <Button variant="contained" disabled={busy || !editing?.email.trim()} onClick={handleSave}>
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
