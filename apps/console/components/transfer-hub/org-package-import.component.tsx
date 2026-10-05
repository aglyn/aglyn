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
 * Importing a workspace package (AGL-3535), in four steps:
 *
 *  1. the file, read in the browser and planned on the server — nothing is
 *     written, and a file changed after it was made is refused;
 *  2. every item against what the workspace holds: new, the same, or
 *     different, with a choice for each one that differs (replacing is
 *     never assumed) and the plugin's objections to any it would refuse;
 *  3. every reference nothing satisfies — a mailbox, a site, a list the
 *     workspace lacks — with a choice: map it to one you have, leave it
 *     out, skip what needs it, or import the package's own copy;
 *  4. the rules each plugin keeps (an imported sequence is a draft), the
 *     warnings to acknowledge, then Import, and Undo for seven days.
 *
 * Every choice plans again on the server, so what is reviewed is what is
 * applied.
 */

import { TransferChoiceSelect, countOf } from '@aglyn/aglyn-transfer-ui'
import {
  TRANSFER_PACKAGE_MAX_BYTES,
  type PackageItemDecision,
  type TransferPackageDependencyChoice,
  type TransferPackagePlanResponse,
  type TransferPackageWarningClass,
  type TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import type { TransferHubClient } from '../../utils/transfer-hub-client'
import { errorText } from './hub-dialog.component'
import { DECISION_WORDS, DEPENDENCY_WORDS, PACKAGE_WARNING_WORDS, REASON_WORDS, STATUS_WORDS, VERDICT_WORDS } from './hub-words'
import OrgPackageUndo from './org-package-undo.component'

export interface OrgPackageImportProps {
  client: TransferHubClient
  /** Called once the import has written, so the history can refresh. */
  onImported?(): void
  onDone(): void
}

/** A chosen file's text, through `FileReader`, which every browser the console runs in has. */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsText(file)
  })
}

const VERDICT_COLORS = {
  create: 'success',
  replace: 'warning',
  keepBoth: 'info',
  skip: 'default',
  fail: 'error',
} as const

export function OrgPackageImport({ client, onImported, onDone }: OrgPackageImportProps) {
  const [plan, setPlan] = useState<TransferPackagePlanResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<string, PackageItemDecision>>({})
  const [dependencyChoices, setDependencyChoices] = useState<Record<string, TransferPackageDependencyChoice>>({})
  const [acknowledged, setAcknowledged] = useState<TransferPackageWarningClass[]>([])
  const [results, setResults] = useState<TransferRowResult[] | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; problems: string[] } | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      const details = (caught as { details?: { problems?: unknown } }).details
      setError({
        message: errorText(caught),
        problems: Array.isArray(details?.problems) ? details.problems.map(String) : [],
      })
    } finally {
      setBusy(false)
    }
  }

  const choose = (file: File) =>
    run(async () => {
      if (file.size > TRANSFER_PACKAGE_MAX_BYTES) throw new Error('A package file holds at most 3 MB.')
      let parsed: unknown
      try {
        parsed = JSON.parse(await readText(file))
      } catch {
        throw new Error('This file is not JSON, so it is not a package.')
      }
      setPlan(await client.plan({ file: parsed, fileName: file.name }))
    })

  const replan = (next: {
    decisions?: Record<string, PackageItemDecision>
    dependencyChoices?: Record<string, TransferPackageDependencyChoice>
  }) =>
    run(async () => {
      if (!plan) return
      const nextDecisions = next.decisions ?? decisions
      const nextChoices = next.dependencyChoices ?? dependencyChoices
      setDecisions(nextDecisions)
      setDependencyChoices(nextChoices)
      const answer = await client.plan({ jobId: plan.job.id, decisions: nextDecisions, dependencyChoices: nextChoices })
      setPlan(answer)
      // A warning whose reason changed is asked again.
      setAcknowledged((current) => current.filter((warning) => answer.acknowledgementsRequired.includes(warning)))
    })

  const apply = () =>
    run(async () => {
      if (!plan) return
      const written: TransferRowResult[] = []
      for (let call = 0; call < 50; call += 1) {
        const answer = await client.apply(plan.job.id, acknowledged)
        written.push(...answer.results)
        if (answer.job.status === 'failed') throw new Error(answer.job.error?.message ?? 'The import stopped. Try again to continue.')
        if (answer.done) break
      }
      setResults(written)
      onImported?.()
    })

  const labelOf = (resource: string) => plan?.resources[resource]?.label ?? resource
  const writes = plan ? plan.summary.create + plan.summary.replace + plan.summary.keepBoth : 0
  const ready = Boolean(
    plan && !plan.blocking.length && writes > 0 && plan.acknowledgementsRequired.every((warning) => acknowledged.includes(warning)),
  )
  const rules = useMemo(
    () =>
      plan
        ? Object.entries(plan.resources)
            .filter(([key]) => plan.items.some((item) => item.kind === key))
            .flatMap(([key, resource]) => resource.rules.map((rule) => ({ ...rule, key: `${key}:${rule.id}`, resource: resource.label })))
        : [],
    [plan],
  )

  if (undoing && plan) {
    return <OrgPackageUndo client={client} jobId={plan.job.id} labels={Object.fromEntries(Object.entries(plan.resources).map(([key, value]) => [key, value.label]))} onUndone={onImported} />
  }

  if (results && plan) {
    const count = (outcome: TransferRowResult['outcome']) => results.filter((result) => result.outcome === outcome).length
    const failed = results.filter((result) => result.outcome === 'failed')
    return (
      <Stack spacing={2}>
        <Alert severity={failed.length ? 'warning' : 'success'}>
          {`Imported: ${countOf(count('created'), 'item')} created, ${countOf(count('updated'), 'item')} replaced, ` +
            `${countOf(count('skipped'), 'item')} skipped` +
            (failed.length ? `, ${countOf(failed.length, 'item')} failed.` : '.')}
        </Alert>
        {failed.length > 0 && (
          <List dense>
            {failed.map((result) => {
              const item = plan.items.find((one) => one.row === result.row)
              return (
                <ListItem key={result.row}>
                  <ListItemText primary={item?.name ?? item?.key} secondary={result.message ?? 'Its plugin refused it.'} />
                </ListItem>
              )
            })}
          </List>
        )}
        <Typography variant="body2" color="text.secondary">
          {'You can undo this import for seven days, here or from the history.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button color="warning" onClick={() => setUndoing(true)}>
            {'Undo the import'}
          </Button>
          <Button variant="contained" onClick={onDone}>
            {'Done'}
          </Button>
        </Stack>
      </Stack>
    )
  }

  if (!plan) {
    return (
      <Stack spacing={2}>
        {error && (
          <Alert severity="error">
            {error.message}
            {error.problems.map((problem) => (
              <Typography key={problem} variant="body2">
                {problem}
              </Typography>
            ))}
          </Alert>
        )}
        <Typography variant="body2">
          {'Choose a package exported from this or another workspace. Nothing is written until you have reviewed every item.'}
        </Typography>
        <Box>
          <Button variant="contained" component="label" disabled={busy}>
            {busy ? 'Reading…' : 'Choose a package file'}
            <input
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void choose(file)
                event.target.value = ''
              }}
            />
          </Button>
          {busy && <CircularProgress size={20} sx={{ ml: 2, verticalAlign: 'middle' }} />}
        </Box>
      </Stack>
    )
  }

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error.message}</Alert>}
      <Typography variant="body2">
        {`${plan.job.fileName ?? 'This package'}${plan.job.package?.source ? ` (from ${plan.job.package.source})` : ''}: ` +
          `${countOf(plan.summary.create, 'item')} to create, ${countOf(plan.summary.replace, 'item')} to replace, ` +
          `${countOf(plan.summary.keepBoth, 'copy', 'copies')} to add, ${countOf(plan.summary.skip, 'item')} skipped` +
          (plan.summary.fail ? `, ${countOf(plan.summary.fail, 'item')} failing.` : '.')}
      </Typography>
      {plan.unknownKinds.length > 0 && (
        <Alert severity="info">
          {`Some items are left out: nothing this workspace runs imports ${plan.unknownKinds.join(', ')}. Turn on the plugin that does and import again.`}
        </Alert>
      )}

      <Box>
        <Typography variant="subtitle1" gutterBottom>
          {'Items'}
        </Typography>
        <ScrollTable size="small">
          <TableHead>
            <TableRow>
              <TableCell>{'Item'}</TableCell>
              <TableCell>{'Compared with yours'}</TableCell>
              <TableCell>{'What happens'}</TableCell>
              <TableCell>{'Choice'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plan.items.map((item) => (
              <TableRow key={item.key}>
                <TableCell>
                  <Typography variant="body2">{item.rename?.name ?? item.name ?? item.id}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {labelOf(item.kind)}
                    {item.existing && item.matchedBy !== 'id' ? ` · matched your “${item.existing.name ?? item.existing.id}” by ${item.matchedBy}` : ''}
                  </Typography>
                </TableCell>
                <TableCell>{STATUS_WORDS[item.status]}</TableCell>
                <TableCell>
                  <Chip size="small" color={VERDICT_COLORS[item.verdict]} label={VERDICT_WORDS[item.verdict]} />
                  {item.reason && item.reason !== 'problems' && (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {REASON_WORDS[item.reason]}
                    </Typography>
                  )}
                  {item.problems.map((problem) => (
                    <Typography key={problem} variant="caption" color="error" component="div">
                      {problem}
                    </Typography>
                  ))}
                </TableCell>
                <TableCell>
                  {item.decisions.length > 1 ? (
                    <TransferChoiceSelect
                      label={`What happens to ${item.name ?? item.id}`}
                      hideLabel
                      value={item.needsChoice ? '' : item.decision}
                      placeholder="Choose"
                      disabled={busy}
                      options={item.decisions.map((decision) => ({ value: decision, ...DECISION_WORDS[decision] }))}
                      onChange={(decision) => replan({ decisions: { ...decisions, [item.key]: decision } })}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      </Box>

      {plan.references.length > 0 && (
        <Box>
          <Typography variant="subtitle1" gutterBottom>
            {'Things this workspace does not have'}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {'Items in the package name these, and neither the package nor this workspace has them. Choose what each becomes.'}
          </Typography>
          <Stack spacing={2}>
            {plan.references.map((reference) => {
              const choice = dependencyChoices[reference.key] ?? reference.choice
              return (
                <Stack key={reference.key} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">{`${reference.label}: ${reference.name ?? reference.id}`}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {`Named by ${countOf(reference.neededBy.length, 'item')}`}
                    </Typography>
                  </Box>
                  <TransferChoiceSelect
                    label="What it becomes"
                    value={choice?.action ?? ''}
                    placeholder="Choose"
                    disabled={busy}
                    options={reference.choices.map((action) => ({
                      value: action,
                      ...DEPENDENCY_WORDS[action],
                      disabled: action === 'mapTo' && !reference.targets.length,
                    }))}
                    onChange={(action) => {
                      if (action === 'mapTo') {
                        const first = reference.targets[0]
                        if (first) replan({ dependencyChoices: { ...dependencyChoices, [reference.key]: { action, id: first.id } } })
                        return
                      }
                      replan({ dependencyChoices: { ...dependencyChoices, [reference.key]: { action } as TransferPackageDependencyChoice } })
                    }}
                  />
                  {choice?.action === 'mapTo' && (
                    <TransferChoiceSelect
                      label={`Which ${reference.label.toLowerCase()}`}
                      value={choice.id}
                      disabled={busy}
                      options={reference.targets.map((target) => ({ value: target.id, label: target.name ?? target.id }))}
                      onChange={(id) => replan({ dependencyChoices: { ...dependencyChoices, [reference.key]: { action: 'mapTo', id } } })}
                    />
                  )}
                </Stack>
              )
            })}
          </Stack>
        </Box>
      )}

      {rules.length > 0 && (
        <Box>
          <Typography variant="subtitle1" gutterBottom>
            {'Rules every import keeps'}
          </Typography>
          <List dense disablePadding>
            {rules.map((rule) => (
              <ListItem key={rule.key} disableGutters>
                <ListItemText primary={`${rule.resource}: ${rule.label}`} secondary={rule.reason} />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {plan.blocking.length > 0 && (
        <Alert severity="warning">
          {plan.blocking.map((sentence) => (
            <Typography key={sentence} variant="body2">
              {sentence}
            </Typography>
          ))}
        </Alert>
      )}

      {plan.acknowledgementsRequired.length > 0 && (
        <Box>
          <Typography variant="subtitle1" gutterBottom>
            {'Before importing'}
          </Typography>
          {plan.acknowledgementsRequired.map((warning) => (
            <FormControlLabel
              key={warning}
              sx={{ alignItems: 'flex-start', display: 'flex' }}
              control={
                <Checkbox
                  checked={acknowledged.includes(warning)}
                  onChange={(event) =>
                    setAcknowledged((current) =>
                      event.target.checked ? [...current, warning] : current.filter((one) => one !== warning),
                    )
                  }
                />
              }
              label={
                <Box sx={{ pt: 1 }}>
                  <Typography variant="body2">{PACKAGE_WARNING_WORDS[warning].title}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {PACKAGE_WARNING_WORDS[warning].description}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        {busy && <CircularProgress size={20} />}
        <Button onClick={onDone} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={apply} disabled={busy || !ready}>
          {`Import ${countOf(writes, 'item')}`}
        </Button>
      </Stack>
    </Stack>
  )
}

export default OrgPackageImport
