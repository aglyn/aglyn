// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// Where the bell's list reaches: every workspace, this workspace, or this site.
enum NotificationReach: String, CaseIterable, Identifiable {
  case all, workspace, site
  var id: String { rawValue }
  var label: String {
    switch self {
    case .all: "All workspaces"
    case .workspace: "This workspace"
    case .site: "This site"
    }
  }
}

/// The bell's popover (AGL-3945, Figma Menus 2:4 "Notifications"; the Notifications sidebar row is gone): All or
/// Unread, where it reaches, each row's level, Mark all read, the gear for settings, and See all.
struct NotificationsPopover: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  @State private var feed = NotificationFeed()
  @State private var unreadOnly = false
  @State private var reach: NotificationReach = .all
  @State private var marking = false

  private static let window = 30

  var body: some View {
    let rows = shown
    VStack(spacing: 0) {
      HStack {
        Text("Notifications").font(AglynFont.headline)
        Spacer()
        Button {
          close { navigation.select(.notifications); navigation.push(.notificationSettings) }
        } label: {
          Label("Notification settings", systemImage: "gearshape").labelStyle(.iconOnly)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("bell-settings")
      }
      .padding(.horizontal, 14)
      .padding(.top, 12)
      HStack {
        Picker("Show", selection: $unreadOnly) {
          Text("All").tag(false)
          Text(unreadCount > 0 ? "Unread · \(unreadCount)" : "Unread").tag(true)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 200)
        .accessibilityIdentifier("bell-filter")
        Spacer()
        Menu {
          Picker("Reach", selection: $reach) {
            ForEach(reaches) { Text($0.label).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          Text(reach.label).font(AglynFont.caption)
        }
        .fixedSize()
        .accessibilityIdentifier("bell-reach")
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      Divider()
      if feed.rows == nil {
        List { SkeletonRows(count: 4) }.listStyle(.plain)
      } else if rows.isEmpty {
        Text(unreadOnly ? "You're all caught up." : "No notifications yet.")
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(24)
          .accessibilityIdentifier("bell-empty")
      } else {
        List(rows) { row in
          Button {
            close { openNotification(row, model: model, navigation: navigation) }
          } label: {
            HStack(alignment: .top, spacing: 10) {
              Circle().fill(row.read ? Color.clear : row.tone.color).frame(width: 8, height: 8).padding(.top, 6)
              VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(row.read ? AglynFont.subheadline : AglynFont.strongSubheadline).lineLimit(2)
                Text(detail(row)).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
              }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.aglynRow)
          .listRowSeparator(.hidden)
          .accessibilityIdentifier("bell-row-\(row.id)")
        }
        .listStyle(.plain)
      }
      Divider()
      HStack {
        Button(marking ? "Marking…" : "Mark all read") { markAll() }
          .buttonStyle(.borderless)
          .disabled(marking || unreadCount == 0)
          .accessibilityIdentifier("bell-mark-all")
        Spacer()
        Button("See all") { close { navigation.select(.notifications) } }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("bell-see-all")
      }
      .font(AglynFont.subheadline)
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
    }
    #if os(macOS)
      .frame(width: 380, height: 480)
    #else
      .frame(minWidth: 320, idealWidth: 380, maxWidth: .infinity, minHeight: 360, idealHeight: 480, maxHeight: .infinity)
      .presentationDetents([.medium, .large])
    #endif
    .background(AglynColor.paper)
    .task(id: "\(model.auth?.user?.uid ?? ""):\(unreadOnly)") {
      feed.start(
        reader: model.reader, uid: model.auth?.user?.uid, count: Self.window,
        filter: NotificationFilter(status: unreadOnly ? .new : .all))
    }
    .onDisappear { feed.stop() }
  }

  private var reaches: [NotificationReach] {
    model.scopedSite(navigation) == nil ? [.all, .workspace] : NotificationReach.allCases
  }

  private var shown: [FeedNotification] {
    let rows = feed.rows ?? []
    switch reach {
    case .all: return rows
    case .workspace:
      let orgID = model.workspace?.org?.id
      return rows.filter { row in
        row.orgID == orgID || (row.hostID.map { id in model.workspace?.sites.contains { $0.id == id } == true } ?? false)
      }
    case .site:
      let hostID = model.scopedSite(navigation)?.id
      return rows.filter { $0.hostID == hostID }
    }
  }

  private var unreadCount: Int { (feed.rows ?? []).filter { !$0.read }.count }

  private func detail(_ row: FeedNotification) -> String {
    let site = row.hostID.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name }
    let org = row.orgID.flatMap { id in model.workspace?.orgs.first { $0.id == id }?.name }
    return [site ?? org, row.createdAt.map { relativeTime($0) }].compactMap { $0 }.joined(separator: " · ")
  }

  private func close(_ then: @escaping () -> Void) {
    dismiss()
    then()
  }

  private func markAll() {
    marking = true
    Task {
      _ = try? await NotificationActions.markAllRead(model: model)
      marking = false
    }
  }
}
