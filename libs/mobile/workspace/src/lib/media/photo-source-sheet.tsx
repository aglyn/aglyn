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

import { ListRow, Sheet } from '@aglyn/mobile-ui'
import type { PhotoSource } from './device-files'

/** Camera or photo library: the one choice an upload or a replace starts with. */
export function PhotoSourceSheet({
  visible,
  title,
  onClose,
  onPick,
}: {
  visible: boolean
  title: string
  onClose: () => void
  onPick: (source: PhotoSource) => void
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ListRow testID="photo-source-camera" icon="camera-outline" title="Take a photo" onPress={() => onPick('camera')} />
      <ListRow
        testID="photo-source-library"
        icon="images-outline"
        title="Choose from your photos"
        onPress={() => onPick('library')}
      />
    </Sheet>
  )
}
