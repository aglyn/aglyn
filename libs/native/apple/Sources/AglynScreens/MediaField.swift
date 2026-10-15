// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynSite
import SwiftUI

/// What a `media` field holds for a file: the path the CDN serves it from, else its address (the console's
/// `MediaUrlField` stores `media.cdnPath ?? media.url`), so the logo and favicon a workspace saves read the same in the
/// console, the apps and the emails that show them.
func mediaFieldValue(cdnPath: String?, url: String?) -> String { cdnPath ?? url ?? "" }

/// A file chosen from the workspace's media library (`kind: "media"`), as the console's `MediaUrlField` offers it: the
/// logo, favicon or image is picked, never typed. The picker is the one the site's Setup uses (`MediaPickField`), over
/// the workspace's library alone; the value is the file's `cdnPath` (else its address).
struct MediaFieldView: View {
  let field: FieldSpec
  @Binding var value: FieldValue
  @Environment(\.aglynPluginContext) private var plugin

  private var stored: String {
    if case .text(let text) = value { return text }
    return ""
  }

  var body: some View {
    if let plugin {
      MediaPickField(
        context: plugin, label: field.label, value: stored, enabled: plugin.orgID != nil, workspaceOnly: true,
        onPick: { chosen in value = .text(mediaFieldValue(cdnPath: chosen.item.cdnPath, url: chosen.item.url)) },
        onClear: { value = .text("") })
    }
  }
}
