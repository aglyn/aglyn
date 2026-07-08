/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {
  getMdiAllIcons,
  getMdiIconFromId,
  type Icon,
  type IconId,
  loadMdiIcons,
} from '@aglyn/shared-data-mdi'
import { useEffect, useMemo, useState } from 'react'

export function useMdiIcons(iconId?: IconId[]): Icon[] {
  // The catalog loads lazily on first use (AGL-189); `ready` flips once the
  // MdiIcons map is populated so the memo recomputes with the full set.
  const [ready, setReady] = useState(() => getMdiAllIcons().size > 0)
  useEffect(() => {
    if (ready) return
    let active = true
    void loadMdiIcons().then((icons) => {
      if (active && icons.size > 0) setReady(true)
    })
    return () => {
      active = false
    }
  }, [ready])

  return useMemo(() => {
    const MdiIcons = getMdiAllIcons()
    return Array.isArray(iconId)
      ? [...iconId].map(getMdiIconFromId)
      : [...MdiIcons.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconId, ready])
}
export default useMdiIcons
