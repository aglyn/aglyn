// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// A documentation or legal page the app links to; each opens in the in-app browser screen.
struct HelpLink: Identifiable, Equatable {
  let id: String
  let title: String
  let systemImage: String
  let url: URL

  /// The console user menu's Documentation, the docs' What's new, and the Terms of Service and Privacy Policy the
  /// sign-up links to, from the build's own docs and legal origins (a self-hosted build's, never ours).
  static func all(_ config: AglynConfig?) -> [HelpLink] {
    let docs = config?.docsOrigin ?? AglynConfig.defaultDocsOrigin
    let legal = config?.legalOrigin ?? AglynConfig.defaultLegalOrigin
    return [
      ("docs", "Documentation", "book", "\(docs)/"),
      ("whats-new", "What's new", "sparkles", "\(docs)/whats-new"),
      ("terms", "Terms of Service", "doc.text", "\(legal)/legal/terms"),
      ("privacy", "Privacy Policy", "hand.raised", "\(legal)/legal/privacy"),
    ].compactMap { id, title, image, address in
      URL(string: address).map { HelpLink(id: id, title: title, systemImage: image, url: $0) }
    }
  }
}

/// The Help section of Settings on iPhone and iPad.
struct HelpSection: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL

  var body: some View {
    Section("Help") {
      ForEach(HelpLink.all(model.config)) { link in
        Button {
          openURL(link.url)
        } label: {
          AglynRow(link.title, systemImage: link.systemImage) {
            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
          }
        }
        .buttonStyle(.aglynRow)
        .accessibilityIdentifier("help-\(link.id)")
      }
    }
  }
}

/// The Mac's Help menu (and iPad's, with a keyboard): the same pages, in the window's browser screen.
struct HelpCommands: Commands {
  let model: AppModel
  @FocusedValue(\.shellNavigation) private var navigation

  var body: some Commands {
    CommandGroup(replacing: .help) {
      ForEach(HelpLink.all(model.config)) { link in
        Button(link.title) { navigation?.openWeb(AglynWebPage(link.url)) }
          .disabled(navigation == nil)
      }
    }
  }
}
