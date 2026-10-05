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

/**
 * Exporting a workspace package (AGL-3535): every sequence, campaign,
 * automation and email template the workspace holds, grouped by what it
 * is, each picked or not, with what the picked ones need added when asked.
 * The file is the same `aglyn-package` a site exports; any workspace's hub
 * imports it.
 */

import type { TransferPackageResourceList } from '@aglyn/aglyn/data-transfer'
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type { TransferHubClient } from '../../utils/transfer-hub-client'
import { errorText, saveBlob } from './hub-dialog.component'

export interface OrgPackageExportProps {
  client: TransferHubClient
  /** Only these resources are picked at first; every one when absent. */
  resources?: readonly string[]
  onDone(): void
}

export function OrgPackageExport({ client, resources, onDone }: OrgPackageExportProps) {
  const [lists, setLists] = useState<TransferPackageResourceList[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [dependencies, setDependencies] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    client
      .listPackageItems()
      .then((answer) => {
        if (!active) return
        setLists(answer.resources)
        setPicked(
          new Set(
            answer.resources
              .filter((list) => !resources?.length || resources.includes(list.key))
              .flatMap((list) => list.items.map((item) => item.key)),
          ),
        )
      })
      .catch((caught) => active && setError(errorText(caught)))
    return () => {
      active = false
    }
  }, [client, resources])

  // What the picked items name that is itself an item here, and not picked.
  const needed = useMemo(() => {
    const held = new Set((lists ?? []).flatMap((list) => list.items.map((item) => item.key)))
    const extra = new Set<string>()
    for (const list of lists ?? []) {
      for (const item of list.items) {
        if (!picked.has(item.key)) continue
        for (const dep of item.deps) {
          const key = `${dep.kind}/${dep.id}`
          if (held.has(key) && !picked.has(key)) extra.add(key)
        }
      }
    }
    return extra
  }, [lists, picked])

  const toggle = (keys: readonly string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const file = await client.exportPackage({ items: [...picked], dependencies })
      saveBlob(file.body, file.fileName)
      onDone()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!lists && !error) return <CircularProgress size={24} />
  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {lists && !lists.length && (
        <Alert severity="info">{'No plugin this workspace runs exports a package yet.'}</Alert>
      )}
      {(lists ?? []).map((list) => {
        const keys = list.items.map((item) => item.key)
        const all = keys.length > 0 && keys.every((key) => picked.has(key))
        return (
          <Box key={list.key}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={all}
                  indeterminate={!all && keys.some((key) => picked.has(key))}
                  disabled={!keys.length}
                  onChange={(event) => toggle(keys, event.target.checked)}
                />
              }
              label={<Typography variant="subtitle2">{`${list.label} (${keys.length})`}</Typography>}
            />
            {list.description && (
              <Typography variant="body2" color="text.secondary" sx={{ ml: 4 }}>
                {list.description}
              </Typography>
            )}
            <Stack sx={{ ml: 4 }}>
              {list.items.map((item) => (
                <FormControlLabel
                  key={item.key}
                  control={
                    <Checkbox size="small" checked={picked.has(item.key)} onChange={(event) => toggle([item.key], event.target.checked)} />
                  }
                  label={
                    <Typography variant="body2">
                      {item.name || item.id}
                      {needed.has(item.key) && dependencies ? ' — added: a picked item needs it' : ''}
                    </Typography>
                  }
                />
              ))}
            </Stack>
          </Box>
        )
      })}
      <FormControlLabel
        control={<Switch checked={dependencies} onChange={(event) => setDependencies(event.target.checked)} />}
        label={
          needed.size
            ? `Include what they need (${needed.size} more)`
            : 'Include what they need'
        }
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={onDone} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={download} disabled={busy || !picked.size}>
          {busy ? 'Exporting…' : `Download ${picked.size + (dependencies ? needed.size : 0)} items`}
        </Button>
      </Stack>
    </Stack>
  )
}

export default OrgPackageExport
