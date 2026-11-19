// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// One card in Customize dashboard: its stored id, its title, and the ids of the cards it may move among (nil: it
/// stays where it is, as the console's Traffic card does).
public struct DashboardCustomizeRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let groupIDs: [String]?

  public init(id: String, title: String, groupIDs: [String]? = nil) {
    self.id = id
    self.title = title
    self.groupIDs = groupIDs
  }
}

/// The console's Customize dashboard dialog: a switch per card and Move up / Move down within its group. Each change
/// is saved as it is made; Done only closes. The Kotlin kit's `DashboardCustomizeSheet`.
public struct DashboardCustomizeSheet: View {
  let rows: [DashboardCustomizeRow]
  let ready: Bool
  let isHidden: (String) -> Bool
  let setHidden: (String, Bool) -> Void
  let move: ([String], String, Int) -> Void
  @Environment(\.dismiss) private var dismiss

  public init(
    rows: [DashboardCustomizeRow], ready: Bool, isHidden: @escaping (String) -> Bool,
    setHidden: @escaping (String, Bool) -> Void, move: @escaping ([String], String, Int) -> Void
  ) {
    self.rows = rows
    self.ready = ready
    self.isHidden = isHidden
    self.setHidden = setHidden
    self.move = move
  }

  public var body: some View {
    NavigationStack {
      Form {
        Section {
          if !ready {
            ProgressView().frame(maxWidth: .infinity)
          } else {
            ForEach(rows) { row in line(row) }
          }
        } footer: {
          Text("Switch off the cards you do not need. Nothing is deleted — turn one back on any time.")
        }
      }
      .navigationTitle("Customize dashboard")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.accessibilityIdentifier("dashboard-customize-done")
        }
      }
    }
    .accessibilityIdentifier("dashboard-customize")
  }

  private func line(_ row: DashboardCustomizeRow) -> some View {
    let hidden = isHidden(row.id)
    let position = row.groupIDs?.firstIndex(of: row.id) ?? -1
    let last = (row.groupIDs?.count ?? 0) - 1
    return HStack(spacing: AglynSpace.one) {
      Toggle(isOn: Binding(get: { !hidden }, set: { setHidden(row.id, !$0) })) {
        Text(row.title).foregroundStyle(hidden ? HierarchicalShapeStyle.secondary : HierarchicalShapeStyle.primary)
      }
      .accessibilityLabel("Show \(row.title)")
      .accessibilityIdentifier("dashboard-show-\(row.id)")
      Button {
        move(row.groupIDs ?? [], row.id, -1)
      } label: {
        Image(systemName: "arrow.up")
      }
      .buttonStyle(.borderless)
      .disabled(position <= 0)
      .accessibilityLabel("Move \(row.title) up")
      .accessibilityIdentifier("dashboard-up-\(row.id)")
      Button {
        move(row.groupIDs ?? [], row.id, 1)
      } label: {
        Image(systemName: "arrow.down")
      }
      .buttonStyle(.borderless)
      .disabled(position < 0 || position >= last)
      .accessibilityLabel("Move \(row.title) down")
      .accessibilityIdentifier("dashboard-down-\(row.id)")
    }
  }
}
