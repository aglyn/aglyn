// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The site's redirect rules. Read-only in the app; in a wide window the
/// list sits beside the selected rule's detail. Editing opens the console's
/// own Redirects page, which owns the validation and the publish role a rule needs.
struct RedirectsListScreen: View {
  let context: NativePluginContext
  @State private var model = HostRedirectsModel()
  @State private var selection: RedirectRow.ID?

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          RedirectDetail(row: model.rows.first { $0.id == selection }, titled: false)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Redirects")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          context.openConsolePath("/redirects", scope: .site)
        } label: {
          Label("Manage in the console", systemImage: "safari")
        }
        .help("Manage in the console")
      }
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 4) }
    } else if model.failed {
      AglynEmptyState("Could not load this site's redirects", systemImage: "exclamationmark.triangle")
    } else if model.rows.isEmpty {
      AglynEmptyState(
        "No redirects yet", systemImage: RedirectsSymbols.rule,
        message: "Rules you add in the console show up here."
      ) {
        Button("Manage in the console") { context.openConsolePath("/redirects", scope: .site) }
      }
    } else if selectable {
      List(model.rows, selection: $selection) { row in
        RedirectListRow(row: row).tag(row.id)
      }
      // A wide window never shows an empty detail pane while there are rules.
      .onChange(of: model.rows, initial: true) { _, rows in
        if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
      }
      .sensoryFeedback(.selection, trigger: selection)
      .accessibilityIdentifier("redirects-list")
    } else {
      List(model.rows) { row in
        NavigationLink {
          RedirectDetail(row: row)
        } label: {
          RedirectListRow(row: row)
        }
        .accessibilityIdentifier("redirect-\(row.id)")
      }
      .accessibilityIdentifier("redirects-list")
    }
  }
}

struct RedirectListRow: View {
  let row: RedirectRow

  var body: some View {
    AglynRow(
      row.source, subtitle: "\(row.statusCode) → \(row.destination)",
      systemImage: row.isOn ? RedirectsSymbols.rule : RedirectsSymbols.paused,
      tint: row.isOn ? nil : .secondary
    ) {
      if !row.isOn { StatusChip("Off") }
    }
  }
}

struct RedirectDetail: View {
  let row: RedirectRow?
  /// False beside the list, where the screen's own title stays.
  var titled = true

  var body: some View {
    if let row {
      Form {
        Section {
          LabeledContent("From", value: row.source)
          LabeledContent("Sends visitors to", value: row.destination)
        }
        Section {
          LabeledContent("Status", value: "\(row.statusCode) \(row.statusCode == 301 ? "Permanent" : row.statusCode == 302 ? "Temporary" : "")")
          LabeledContent("Match", value: (row.rule.kind ?? .exact).rawValue.capitalized)
          LabeledContent("Priority", value: row.priority.formatted())
          LabeledContent("State") { StatusChip(row.isOn ? "On" : "Off", tone: row.isOn ? .success : .neutral) }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(titled ? row.source : "Redirects")
    } else {
      AglynEmptyState("Pick a redirect to see it here", systemImage: RedirectsSymbols.rule)
    }
  }
}
