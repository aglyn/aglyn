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

/**
 * The Lightbox element (AGL-3717): any elements an author drops in, hidden
 * until something opens them in a dialog.
 *
 * ## How it opens
 *
 * With the interactions system's existing visibility steps — *Show an
 * element*, *Hide an element*, *Show/hide an element* — aimed at it, from any
 * button, link or picture. The element renders an empty anchor carrying the
 * shared hidden class, which is what those steps already move; core tells the
 * anchor a step reached it (`subscribeElementVisibility`), and the element
 * opens or closes its dialog. So a toggle reads the right state, an Escape or
 * outside-click dismissal a step armed still works, and no new step type,
 * plan gate or editor field was needed.
 *
 * ## Nothing inside loads until it opens
 *
 * The children are not rendered on the page at all — not hidden, absent. A
 * picture, a video or a form inside a Lightbox makes no request until a
 * visitor opens it, and the dialog's own code (`lightbox-panel.tsx`, the
 * shared lightbox shell) is a chunk fetched on the first open.
 *
 * ## On the canvas
 *
 * A slim marker, like the Drawer's (AGL-1236), that expands into the open
 * panel while the Lightbox or anything inside it is selected, so its contents
 * are designed in the shape they ship in.
 */
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { mdiClose, mdiImageFilterCenterFocus } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  type LightboxAppearanceProps,
  splitLightboxAppearanceProps,
} from '@aglyn/shared-ui-jsx/components/lightbox/lightbox-appearance'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import { alpha, type SxProps } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import useForkRef from '@mui/utils/useForkRef'
import {
  forwardRef,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { lightboxAppearanceAttributes } from '../utils/lightbox-attributes'

const LightboxPanel = lazy(() =>
  import('./lightbox-panel').then((module) => ({
    default: module.LightboxPanel,
  })),
)

// Component ids are persisted in screen documents; never rename.
export const LIGHTBOX_ID: Aglyn.ComponentId = 'lightbox'

export interface LightboxElementProps extends LightboxAppearanceProps {
  /** The dialog's accessible name, e.g. "Book a call". */
  label?: string
  /** Authored node styles: they land on the open panel's body. */
  sx?: SxProps
  className?: string
  children?: ReactNode
}

/** What a dialog is called when the author gave it no name. */
const FALLBACK_LABEL = 'Lightbox'

/** The anchor takes no room in the row it sits in (the Drawer's AGL-1236 box). */
const MARKER_SX = {
  position: 'absolute',
  width: 0,
  height: 0,
  overflow: 'visible',
  m: 0,
  p: 0,
} as const

/** The besigner stamps this while the node or a descendant is selected (AGL-571). */
function isSelectedWithin(rest: Record<string, unknown>): boolean {
  return rest['data-aglyn-selected-within'] != null
}

const LightboxElement = forwardRef<HTMLDivElement, LightboxElementProps>(
  (allProps, ref) => {
    const { appearance, rest: props } = splitLightboxAppearanceProps(allProps)
    const { label, children, sx, className, ...rest } = props
    const name = label?.trim() || FALLBACK_LABEL
    const { editorInert } = Aglyn.useScreenLink(undefined)
    const anchorRef = useRef<HTMLDivElement>(null)
    const rootRef = useForkRef(ref, anchorRef)
    const [open, setOpen] = useState(false)
    // `armed` never goes back: the panel's chunk stays resolved after a close.
    const [armed, setArmed] = useState(false)

    useEffect(() => {
      const anchor = anchorRef.current
      if (editorInert || !anchor) return undefined
      return Aglyn.subscribeElementVisibility(anchor, ({ hidden }) => {
        if (hidden) {
          setOpen(false)
          return
        }
        setArmed(true)
        setOpen(true)
      })
    }, [editorInert])

    /**
     * The dialog closed itself — its close control, Escape, the backdrop.
     * The anchor takes the hidden class back, so the next toggle opens.
     */
    const close = useCallback(() => {
      setOpen(false)
      anchorRef.current?.classList.add(Aglyn.ELEMENT_HIDDEN_CLASS)
    }, [])

    if (editorInert) {
      if (isSelectedWithin(rest as Record<string, unknown>)) {
        // Selected: the panel as it opens, over the design surface, so the
        // author designs its contents at their real size.
        return (
          <Box ref={rootRef} {...rest} sx={MARKER_SX}>
            <Box
              sx={{
                position: 'fixed',
                inset: 0,
                zIndex: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 2,
                bgcolor: (theme) => alpha(theme.palette.common.black, 0.5),
              }}
            >
              <Box
                sx={[
                  {
                    position: 'relative',
                    width: '100%',
                    maxWidth: appearance.maxWidth ?? 600,
                    maxHeight: '100%',
                    overflowY: 'auto',
                    bgcolor: 'background.paper',
                    borderRadius: appearance.radius !== undefined ? `${appearance.radius}px` : 1,
                    boxShadow: 24,
                    p: appearance.padding ?? 3,
                    pt: appearance.padding ?? 5,
                  },
                  ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
                ]}
              >
                <IconButton
                  aria-label={`Close ${name}`}
                  size="small"
                  disabled
                  sx={{ position: 'absolute', top: 8, right: 8 }}
                >
                  <MdiIcon path={mdiClose.path} fontSize="small" />
                </IconButton>
                {children}
              </Box>
            </Box>
          </Box>
        )
      }
      return (
        <Box ref={rootRef} {...rest} sx={MARKER_SX}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'inline-block',
              px: 0.75,
              py: 0.25,
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 1,
              backgroundColor: 'background.paper',
              whiteSpace: 'nowrap',
              lineHeight: 1.4,
              opacity: 0.85,
            }}
          >
            {`Lightbox · ${name}`}
          </Typography>
        </Box>
      )
    }

    return (
      <>
        <Box
          ref={rootRef}
          {...rest}
          // Hidden until a step shows it: the class the visibility steps move.
          className={[className, Aglyn.ELEMENT_HIDDEN_CLASS].filter(Boolean).join(' ')}
          sx={MARKER_SX}
        />
        {armed ? (
          <Suspense fallback={null}>
            <LightboxPanel
              open={open}
              onClose={close}
              label={name}
              appearance={appearance}
              sx={sx as never}
            >
              {children}
            </LightboxPanel>
          </Suspense>
        ) : null}
      </>
    )
  },
)
LightboxElement.displayName = 'AglynLightbox'

export const lightboxSchema: Aglyn.ComponentSchema<LightboxElementProps> = {
  $id: LIGHTBOX_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Lightbox',
  description:
    'Any elements in a lightbox, hidden until a "Show an element" interaction opens it.',
  category: Aglyn.ComponentCategory.SURFACE,
  icon: { path: mdiImageFilterCenterFocus.path, sx: { color: 'secondary.main' } },
  attributes: [
    {
      name: 'label',
      description:
        'What a screen reader announces when the lightbox opens, e.g. ' +
        '"Book a call". Also names the close button.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Accessible name',
    },
    ...lightboxAppearanceAttributes(),
  ],
}

const text = (children: string, variant: string) => ({
  $id: null,
  componentId: 'muiTypography',
  pluginId: 'mui',
  props: { children, variant },
})

export const lightboxPresets: Aglyn.PresetSchema[] = [
  {
    $id: `${BUNDLE_ID}:${LIGHTBOX_ID}`,
    type: Aglyn.NodeType.PRESET,
    displayName: 'Lightbox',
    pluginId: BUNDLE_ID,
    description:
      'A heading and text in a lightbox; open it from a button with a ' +
      '"Show an element" interaction',
    category: Aglyn.ComponentCategory.SURFACE,
    icon: lightboxSchema.icon,
    data: {
      $id: null,
      componentId: LIGHTBOX_ID,
      pluginId: BUNDLE_ID,
      props: { label: 'More details' },
      nodes: [
        text('More details', 'h5'),
        text(
          'Put anything here: text, a form, a video or pictures. It loads ' +
            'only when a visitor opens the lightbox.',
          'body1',
        ),
      ],
    },
  },
]

export default LightboxElement
