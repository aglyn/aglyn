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

import { AppLink, type AppLinkNakedLinkProps } from '@aglyn/shared-ui-jsx'
import { Button, Menu, MenuItem } from '@mui/material'
import { forwardRef, useState } from 'react'
import { orgSiteHubPath, type MarketingOrgMount } from './marketing-org-mount'

/** A site's own Marketing hub at `section`, or `null` when it has no address. */
export function orgSiteSectionHref(
  mount: MarketingOrgMount,
  hostId: string,
  section: string,
): string | null {
  const hub = orgSiteHubPath(mount, hostId, 'marketing')
  return hub ? `${hub}/${section}` : null
}

/** The anchor a site in the menu renders as — a real link, like every other. */
const MenuItemLink = forwardRef<any, AppLinkNakedLinkProps>((props, ref) => (
  <AppLink ref={ref} {...props} componentVariant={'naked'} />
))
MenuItemLink.displayName = 'OrgSitePickerMenuItemLink'

export interface OrgSitePickerButtonProps {
  mount: MarketingOrgMount
  /** The section of the site's Marketing hub to open — `overlays`, `experiments`. */
  section: string
  label: string
}

/**
 * The org hub's way into anything that is EDITED on a site: a button that
 * opens one of the organization's sites at a section of its own Marketing
 * hub.
 *
 * An overlay is drawn on one site's pages and an A/B test splits one site's
 * traffic, so their editors belong to the site — the org hub lists them and
 * sends the reader to the site to write. With one site there is nothing to
 * choose and the button is the link; with several it opens a menu of them.
 * A site the shell could not give a subdomain is listed and disabled: it has
 * no hub address to open.
 */
export function OrgSitePickerButton(props: OrgSitePickerButtonProps) {
  const { mount, section, label } = props
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const sites = mount.hosts

  if (sites.length === 1) {
    const href = orgSiteSectionHref(mount, sites[0].id, section)
    return href ? (
      <AppLink
        componentVariant="button"
        href={href}
        size="small"
        color="primary"
        variant="contained"
      >
        {label}
      </AppLink>
    ) : (
      <Button size="small" color="primary" variant="contained" disabled>
        {label}
      </Button>
    )
  }

  return (
    <>
      <Button
        size="small"
        color="primary"
        variant="contained"
        disabled={!sites.length}
        aria-haspopup="true"
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        slotProps={{ list: { 'aria-label': `${label} on which site` } }}
      >
        {sites.map((site) => {
          const href = orgSiteSectionHref(mount, site.id, section)
          return (
            <MenuItem
              key={site.id}
              {...((href
                ? { component: MenuItemLink, href }
                : { disabled: true }) as any)}
              onClick={() => setAnchorEl(null)}
            >
              {site.name || site.subdomain || site.id}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
OrgSitePickerButton.displayName = 'OrgSitePickerButton'

export default OrgSitePickerButton
