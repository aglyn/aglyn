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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import { openSitePreview } from '@aglyn/tenant-feature-instance/components/site-preview-switch'
import { Button, type ButtonProps } from '@mui/material'
import type { ReactNode } from 'react'

export interface SiteVisitButtonProps {
  hostId: string | null | undefined
  /** The site's ordinary address, as the button has always opened it. */
  href: string
  /** The site is in preview, so the button enters it as the team. */
  inPreview: boolean
  variant?: ButtonProps['variant']
  color?: ButtonProps['color']
  children: ReactNode
}

/**
 * "Visit" / "Visit site" (AGL-4086): the console's way onto the live site.
 *
 * A public site opens at its address, as it always has. A site in preview
 * opens through a console-minted enter link instead, which recognizes the
 * person as the site's team on whatever address the site has — the
 * `.aglyn.app` subdomain or the customer's own domain, where no console cookie
 * can reach — so one click shows the team the whole site in both places.
 */
export function SiteVisitButton(props: SiteVisitButtonProps) {
  const { hostId, href, inPreview, variant, color, children } = props
  const { data: user } = useUser()
  if (!inPreview || !hostId) {
    return (
      <AppLink
        componentVariant="button"
        variant={variant}
        color={color}
        href={href}
        newTab
        rel="nofollow"
      >
        {children}
      </AppLink>
    )
  }
  return (
    <Button
      variant={variant}
      color={color}
      onClick={() => void openSitePreview(user, hostId, href)}
    >
      {children}
    </Button>
  )
}
SiteVisitButton.displayName = 'SiteVisitButton'

export default SiteVisitButton
