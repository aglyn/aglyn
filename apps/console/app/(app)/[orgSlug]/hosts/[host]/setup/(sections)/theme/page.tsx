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

import ThemeEditor from '../../../../../../../../components/theme-editor/theme-editor.component'
import ThemeOverridesCard from '../../../../../../../../components/theme-editor/theme-overrides-card.component'
import ThemeSourceCard from '../../../../../../../../components/theme-editor/theme-source-card.component'
import { useSetupScope } from '../layout'

/**
 * Theme — where the site's theme came from, what has been changed in it, and
 * the editor (AGL-2501).
 *
 * Gated on `hostHasEmitted` rather than on a success status (AGL-1066): a
 * refused listen can reach `'error'` while the persistent cache is still
 * serving the host document, and collapsing this section to nothing with the
 * theme right there in memory is the outcome that issue decided against.
 */
export default function HostSetupThemeSection() {
  const {
    hostId,
    data,
    hostHasEmitted,
    resolvedTheme,
    themeSaving,
    handleThemeSave,
    handleWriteOverride,
  } = useSetupScope()
  if (!hostHasEmitted) return null
  return (
    <>
      {/* Where the theme came from, and the ways back (AGL-1020). Above the
          editor because "am I editing my own theme or a publisher's" changes
          what every control below it means. */}
      <div style={{ marginBottom: 24 }}>
        <ThemeSourceCard
          hostId={hostId}
          theme={data?.theme}
          installedFrom={data?.themeInstalledFrom}
          replaced={data?.themeReplaced}
        />
      </div>
      {/* "What have I changed?" is a read of the stored patch (AGL-1021), so
          it cannot disagree with what is applied. Only meaningful for an
          installed theme — a site's own theme has no publisher's version to
          differ from. */}
      <div style={{ marginBottom: 24 }}>
        <ThemeOverridesCard
          hostId={hostId}
          host={data}
          onWriteOverride={handleWriteOverride}
        />
      </div>
      <ThemeEditor
        theme={resolvedTheme}
        saving={themeSaving}
        onSave={handleThemeSave}
      />
    </>
  )
}
