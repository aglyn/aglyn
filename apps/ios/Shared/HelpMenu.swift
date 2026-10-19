// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// "?" in the title bar (AGL-3945, Figma Menus 2:4 "Help"): the docs for this screen, What's new, Keyboard shortcuts,
/// Terms and Privacy, Report an issue, Contact support and Report abuse. Web pages open in the in-app browser screen
/// (its own tab on the Mac), so the right-hand panel stays the AI's.
struct HelpMenuItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    let links = HelpLink.all(model.config)
    let scope = ShellScope(model: model, navigation: navigation)
    Section {
      if let docs = links.first(where: { $0.id == "docs" }) {
        Button("\(scope.row(for: navigation.section)?.label ?? "Aglyn") help", systemImage: "book") {
          navigation.openWeb(AglynWebPage(HelpPages.docs(for: scope.row(for: navigation.section), base: docs.url)), .newTab)
        }
        .accessibilityIdentifier("help-docs")
      }
      if let whatsNew = links.first(where: { $0.id == "whats-new" }) {
        Button("What's new", systemImage: "sparkles") { navigation.openWeb(AglynWebPage(whatsNew.url), .newTab) }
      }
      Button("Keyboard shortcuts", systemImage: "keyboard") { navigation.showShortcuts = true }
        .accessibilityIdentifier("help-shortcuts")
    }
    Section {
      if let terms = links.first(where: { $0.id == "terms" }) {
        Button("Terms of Service", systemImage: "doc.text") { navigation.openWeb(AglynWebPage(terms.url), .newTab) }
      }
      if let privacy = links.first(where: { $0.id == "privacy" }) {
        Button("Privacy Policy", systemImage: "hand.raised") { navigation.openWeb(AglynWebPage(privacy.url), .newTab) }
      }
      if model.registry.screen(AccountPlaces.reportScreen) != nil {
        Button("Report an issue", systemImage: "flag") { navigation.push(.screen(AccountPlaces.reportScreen, [:])) }
        Button("Contact support", systemImage: "lifepreserver") {
          navigation.push(.screen(AccountPlaces.reportScreen, [:]))
        }
      }
      if let abuse = HelpPages.reportAbuse(model.config) {
        Button("Report abuse", systemImage: "exclamationmark.shield") { navigation.openWeb(AglynWebPage(abuse), .newTab) }
      }
    }
  }
}

enum HelpPages {
  /// The docs page for a screen: its area's page when the manifest names one, else the docs' front page.
  static func docs(for row: NativeNavRow?, base: URL) -> URL { base }

  /// The abuse intake every Aglyn origin serves (`/api/report-abuse`).
  static func reportAbuse(_ config: AglynConfig?) -> URL? {
    config.flatMap { URL(string: "\($0.consoleOrigin)/api/report-abuse") }
  }
}

/// The "?" button.
struct HelpMenuButton: View {
  var body: some View {
    Menu {
      HelpMenuItems()
    } label: {
      Label("Help", systemImage: "questionmark.circle")
    }
    .menuIndicator(.hidden)
    .help("Help")
    .accessibilityIdentifier("titlebar-help")
  }
}

/// Keyboard shortcuts, as the menu bar and an iPad's keyboard know them.
struct KeyboardShortcutsSheet: View {
  @Environment(\.dismiss) private var dismiss

  private let shortcuts: [(String, String)] = [
    ("⌘K", "Search or jump to"),
    ("⌘1 – ⌘5", "Your pinned workspaces"),
    ("⌘⇧K", "Switch site"),
    ("⌘[  ⌘]", "Back and forward"),
    ("⌘T", "New tab"),
    ("⌘W", "Close tab"),
    ("⌘⇧T", "Reopen the tab you closed"),
    ("⌘⇧H", "Home"),
    ("⌘⇧N", "Notifications"),
    ("⌘⌥I", "AI panel"),
    ("⌘R", "Refresh"),
  ]

  var body: some View {
    NavigationStack {
      List(shortcuts, id: \.0) { keys, action in
        HStack {
          Text(action)
          Spacer()
          Text(keys).font(AglynFont.body.monospaced()).foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Keyboard shortcuts")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .aglynSheetMinimumSize(width: 380, height: 460)
  }
}
