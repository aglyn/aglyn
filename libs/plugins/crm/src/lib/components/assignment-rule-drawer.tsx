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
  CONTACT_SOURCE_LABELS,
  type ContactSource,
  type CrmAssignmentRule,
  newAssignmentRuleId,
  readCrmAssignmentRule,
} from '@aglyn/aglyn'
import {
  Button,
  Drawer,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { OrgMemberOption } from '../hooks/use-org-member-directory'

/** The `value` of the source picker's "any door" entry. */
const ANY_SOURCE = ''

export interface AssignmentRuleDrawerProps {
  open: boolean
  onClose: () => void
  /** The roster the member target is picked from. */
  members: readonly OrgMemberOption[]
  membersLoading: boolean
  /** How many people the round-robin pool holds, for the target's helper text. */
  poolSize: number
  /** The ids the org already holds, so the new one is minted apart from them. */
  existingIds: readonly string[]
  /** Receives the rule; closing on success is the caller's job. */
  onSubmit: (rule: CrmAssignmentRule) => Promise<void> | void
}

/**
 * The one form an assignment rule is written through (AGL-2618).
 *
 * ## Every condition is optional, and none is a form above the list
 *
 * A rule names the captures it claims — a source, a form, an email domain,
 * a tag — and a field left blank is not a condition, so a rule with every
 * field blank is the catch-all, which is a rule a team writes on purpose
 * ("everything else goes to Sam"). The drawer says so rather than refusing
 * it. The email domain is typed the way a person sees one in an address,
 * `@acme.com` or `acme.com`, and the reader strips the `@`; what it cannot
 * read as a domain is refused here, with the field, rather than stored as
 * a condition nothing will ever match.
 *
 * ## The target is a member, or the rotation
 *
 * A member is picked from the roster by name, never typed as an address —
 * an address is resolved at run time and a rule must not depend on a
 * resolution that can change. The rotation is offered whatever the pool
 * holds, with the pool's size beside it: an empty pool is a rule the pass
 * steps over until somebody fills the pool, which the card below explains,
 * and refusing the rule here would make the two cards order-dependent.
 */
export function AssignmentRuleDrawer(props: AssignmentRuleDrawerProps) {
  const { open, onClose, members, membersLoading, poolSize, existingIds, onSubmit } =
    props
  const [source, setSource] = useState<string>(ANY_SOURCE)
  const [formId, setFormId] = useState('')
  const [emailDomain, setEmailDomain] = useState('')
  const [tag, setTag] = useState('')
  const [target, setTarget] = useState<'member' | 'roundRobin'>('member')
  const [memberUid, setMemberUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded on every open, so a drawer that was cancelled halfway does not
  // offer the abandoned draft as the next rule.
  useEffect(() => {
    if (!open) return
    setSource(ANY_SOURCE)
    setFormId('')
    setEmailDomain('')
    setTag('')
    setTarget('member')
    setMemberUid('')
    setBusy(false)
    setError(null)
  }, [open])

  const domainTyped = emailDomain.trim().length > 0
  const domainReadable =
    !domainTyped ||
    readCrmAssignmentRule({
      id: 'probe',
      when: { emailDomain },
      assign: { roundRobin: true },
    })?.when.emailDomain !== undefined
  const canSubmit =
    !busy && domainReadable && (target === 'roundRobin' || memberUid.length > 0)

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    const rule = readCrmAssignmentRule({
      id: newAssignmentRuleId(existingIds),
      when: {
        ...(source ? { source } : {}),
        ...(formId.trim() ? { formId: formId.trim() } : {}),
        ...(emailDomain.trim() ? { emailDomain: emailDomain.trim() } : {}),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
      },
      assign: target === 'roundRobin' ? { roundRobin: true } : { memberUid },
    })
    if (!rule) {
      setError('The rule could not be read back. Check each field.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(rule)
    } catch (caught) {
      console.error(caught)
      setError('Could not save the rule. Try again.')
    } finally {
      setBusy(false)
    }
  }, [canSubmit, existingIds, source, formId, emailDomain, tag, target, memberUid, onSubmit])

  const conditions = [source, formId.trim(), emailDomain.trim(), tag.trim()].filter(Boolean)

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Stack spacing={2} sx={{ width: 380, p: 3 }}>
        <Typography variant="h6">{'New assignment rule'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {'When a new contact matches every condition below, it is assigned ' +
            'as the rule says. Leave every condition blank for a rule that ' +
            'catches everything the rules above it did not.'}
        </Typography>
        <TextField
          select
          size="small"
          label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          fullWidth
        >
          <MenuItem value={ANY_SOURCE}>{'Any source'}</MenuItem>
          {(Object.keys(CONTACT_SOURCE_LABELS) as ContactSource[]).map((option) => (
            <MenuItem key={option} value={option}>
              {CONTACT_SOURCE_LABELS[option]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Form"
          value={formId}
          onChange={(event) => setFormId(event.target.value)}
          helperText="The form's id, from its address in Forms. Blank for any form."
          slotProps={{ htmlInput: { maxLength: 128, spellCheck: false } }}
          fullWidth
        />
        <TextField
          size="small"
          label="Email domain"
          value={emailDomain}
          onChange={(event) => setEmailDomain(event.target.value)}
          error={!domainReadable}
          helperText={
            domainReadable
              ? 'acme.com — the domain of the captured address. Public mailboxes such as gmail.com count.'
              : 'That does not look like a domain.'
          }
          slotProps={{ htmlInput: { maxLength: 253, spellCheck: false } }}
          fullWidth
        />
        <TextField
          size="small"
          label="Tag"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          helperText="A tag the capture carries, or the contact already has."
          slotProps={{ htmlInput: { maxLength: 60 } }}
          fullWidth
        />
        <FormControl>
          <FormLabel id="assignment-rule-target">{'Assign to'}</FormLabel>
          <RadioGroup
            aria-labelledby="assignment-rule-target"
            value={target}
            onChange={(event) =>
              setTarget(event.target.value === 'roundRobin' ? 'roundRobin' : 'member')
            }
          >
            <FormControlLabel value="member" control={<Radio size="small" />} label="A team member" />
            <FormControlLabel
              value="roundRobin"
              control={<Radio size="small" />}
              label="Round robin — the next member of the pool"
            />
          </RadioGroup>
          {target === 'roundRobin' ? (
            <FormHelperText>
              {poolSize > 0
                ? `The pool has ${poolSize} ${poolSize === 1 ? 'member' : 'members'}; each new contact goes to the next in turn.`
                : 'The pool is empty. This rule is skipped until somebody is added to it below.'}
            </FormHelperText>
          ) : null}
        </FormControl>
        {target === 'member' ? (
          <TextField
            select
            size="small"
            label="Member"
            value={memberUid}
            onChange={(event) => setMemberUid(event.target.value)}
            disabled={membersLoading}
            helperText={
              membersLoading
                ? 'Loading the team…'
                : members.length
                  ? undefined
                  : 'The team could not be listed.'
            }
            fullWidth
          >
            {members.map((member) => (
              <MenuItem key={member.uid} value={member.uid}>
                {member.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {conditions.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            {'No conditions: this rule matches every new contact the rules above it did not claim.'}
          </Typography>
        ) : null}
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {'Add rule'}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            {'Cancel'}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  )
}
AssignmentRuleDrawer.displayName = 'AssignmentRuleDrawer'

export default AssignmentRuleDrawer
