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

import { MediaPickerContext } from '@aglyn/besigner-ui'
import { useCallback, useMemo, useRef, useState } from 'react'
import MediaPickerDialog from './media/media-picker-dialog.component'

export interface BesignerMediaPickerProviderProps {
  hostId: string
  children?: JSX.Children
}

/**
 * Feeds the designer's "Browse media" action (AGL-106): opens the console's
 * media-picker dialog and hands the chosen asset URL back to the requesting
 * attribute panel.
 */
export function BesignerMediaPickerProvider(
  props: BesignerMediaPickerProviderProps,
) {
  const { hostId, children } = props
  const [open, setOpen] = useState(false)
  const pendingPick = useRef<((url: string) => void) | null>(null)

  const onPickMedia = useCallback((onPick: (url: string) => void) => {
    pendingPick.current = onPick
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ onPickMedia }), [onPickMedia])

  return (
    <MediaPickerContext.Provider value={value}>
      {children}
      <MediaPickerDialog
        hostId={hostId}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(media) => {
          const url = (media as any).url as string | undefined
          if (url) pendingPick.current?.(url)
          pendingPick.current = null
          setOpen(false)
        }}
      />
    </MediaPickerContext.Provider>
  )
}
BesignerMediaPickerProvider.displayName = 'BesignerMediaPickerProvider'

export default BesignerMediaPickerProvider
