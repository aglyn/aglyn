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
import { AiAssistContext } from '@aglyn/besigner-ui'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useUser } from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

export interface AiAssistProviderProps {
  children?: JSX.Children
}

/**
 * Console-side AI copy assist (AGL-89): provides the designer's "Rewrite
 * with AI" callback, hosts the instruction dialog, and calls the assist API
 * (which 501-degrades when ANTHROPIC_API_KEY isn't configured). The commit
 * spreads the node's current props — `updateNodeProps` REPLACES the props
 * object — and clears any stale rich-text `html` so the new text renders.
 */
export function AiAssistProvider(props: AiAssistProviderProps) {
  const { children } = props
  const { enqueueSnackbar } = useSnackbar()
  const { tenant } = useCurrentTenant()
  const { data: user } = useUser()
  const [node, setNode] = useState<Aglyn.NodeSchema<any> | null>(null)
  const [instruction, setInstruction] = useState('')
  // Rewrite target (AGL-130): 'children' for text-editable elements, or
  // any text attribute the element's schema declares (alt text, labels…).
  const [targetProp, setTargetProp] = useState('children')
  const [busy, setBusy] = useState(false)

  const textTargets = useMemo(() => {
    const schema = node?.componentSchema
    const textEditable =
      ((schema?.flags?.textEditable ?? Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
      0
    const attributes = (schema?.attributes ?? [])
      .filter(
        (field: any) =>
          field.component === Aglyn.FieldComponentType.TEXT_FIELD ||
          field.component === Aglyn.FieldComponentType.TEXTAREA,
      )
      .map((field: any) => ({
        prop: String(field.name),
        label: String(field.label ?? field.name),
      }))
    return textEditable
      ? [{ prop: 'children', label: 'Element text' }, ...attributes]
      : attributes
  }, [node])

  const handleRewrite = useCallback(
    (target: Aglyn.NodeSchema<any>) => {
      if (!hasEntitlement('ai-assist', tenant)) {
        return void enqueueSnackbar(
          'AI assist requires a Pro plan — see Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      setInstruction('')
      setTargetProp('children')
      setNode(target)
    },
    [tenant, enqueueSnackbar],
  )

  // Keep the target valid for the selected element.
  const effectiveTarget = textTargets.some((item) => item.prop === targetProp)
    ? targetProp
    : (textTargets[0]?.prop ?? 'children')

  const handleConfirm = useCallback(async () => {
    if (!node || !instruction.trim() || busy) return
    setBusy(true)
    try {
      const current = (Aglyn.canvas.toJSON().nodes as Record<string, any>)[
        node.$id
      ]
      const text =
        typeof current?.props?.[effectiveTarget] === 'string'
          ? (current.props[effectiveTarget] as string)
          : ''
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ text, instruction: instruction.trim() }),
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
      Aglyn.canvas.updateNodeProps(node, {
        ...current?.props,
        [effectiveTarget]: payload.text,
        // Rich-text elements render `html` over `children`; drop it so the
        // rewrite is what shows (the user can re-format inline afterwards).
        ...(effectiveTarget === 'children' ? { html: undefined } : {}),
      })
      setNode(null)
      enqueueSnackbar('Text rewritten — undo restores the original', {
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
      setBusy(false)
    }
  }, [node, instruction, busy, user, effectiveTarget, enqueueSnackbar])

  const contextValue = useMemo(() => ({ onRewrite: handleRewrite }), [
    handleRewrite,
  ])

  return (
    <AiAssistContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={Boolean(node)}
        onClose={() => (busy ? null : setNode(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Rewrite with AI'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Describe how the text should change — tone, length, message.'}
          </Typography>
          {textTargets.length > 1 ? (
            <TextField
              select
              label="Field"
              value={effectiveTarget}
              onChange={(event) => setTargetProp(event.target.value)}
              size="small"
              disabled={busy}
            >
              {textTargets.map((item) => (
                <MenuItem key={item.prop} value={item.prop}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            label="Instruction"
            placeholder="e.g. Make it punchier and half as long"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            size="small"
            autoFocus
            multiline
            minRows={2}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                handleConfirm()
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setNode(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!instruction.trim() || busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={handleConfirm}
          >
            {busy ? 'Rewriting…' : 'Rewrite'}
          </Button>
        </DialogActions>
      </Dialog>
    </AiAssistContext.Provider>
  )
}
AiAssistProvider.displayName = 'AiAssistProvider'

export default AiAssistProvider
