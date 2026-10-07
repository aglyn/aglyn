// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation
import SwiftUI

struct FeedNotification: Identifiable, Equatable {
  let id: String
  let title: String
  let body: String?
  let link: String?
  let read: Bool
  let level: String?
  let createdAt: Date?

  /// The notification levels as theme tones; unknown or absent reads as info.
  static func tone(_ level: String?) -> AglynTone {
    switch level {
    case "critical", "error": .error
    case "warning": .warning
    case "success": .success
    default: .info
    }
  }
}

/// The person's notifications: the same `users/{uid}/notifications` feed the
/// console's bell reads, newest first, under the same owner-only rules.
@MainActor
@Observable
final class NotificationFeed {
  private(set) var rows: [FeedNotification]?
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(reader: FirestoreReader?, uid: String?, count: Int) {
    listener?.remove()
    guard let reader, let uid else { return }
    listener = reader.listen(
      FirestoreQuery(["users", uid, "notifications"], order: [.init("createdAt", descending: true)], limit: count)
    ) { [weak self] result in
      switch result {
      case .success(let docs):
        self?.failed = false
        self?.rows = docs.map {
          FeedNotification(
            id: $0.id, title: $0.string("title") ?? "", body: $0.string("body"), link: $0.string("link"),
            read: $0.bool("read") == true, level: $0.string("level"), createdAt: $0.date("createdAt"))
        }
      case .failure:
        self?.failed = true
        self?.rows = []
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// Marks a notification read the way the console does (`read` beside
/// `readAt`) and follows its link.
@MainActor
func openNotification(_ row: FeedNotification, model: AppModel, navigation: ShellNavigation) {
  if !row.read, let uid = model.auth?.user?.uid, let reader = model.reader {
    Task {
      try? await reader.setDocument(
        ["users", uid, "notifications", row.id], ["read": true, "readAt": FirestoreSentinel.serverTimestamp],
        merge: true)
    }
  }
  if let link = row.link { model.open(link, in: navigation) }
}

struct NotificationRow: View {
  let row: FeedNotification

  private var icon: String {
    switch row.level {
    case "critical", "error": "xmark.octagon"
    case "warning": "exclamationmark.triangle"
    case "success": "checkmark.circle"
    default: "bell"
    }
  }

  var body: some View {
    ActivityRow(
      row.title, subtitle: row.body, time: row.createdAt.map { relativeTime($0) }, systemImage: icon,
      tone: FeedNotification.tone(row.level), unread: !row.read)
  }
}

struct NotificationsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var feed = NotificationFeed()

  var body: some View {
    Group {
      if let rows = feed.rows {
        if feed.failed {
          AglynEmptyState("Could not load your notifications", systemImage: "exclamationmark.triangle")
        } else if rows.isEmpty {
          AglynEmptyState(
            "No notifications", systemImage: "bell",
            message: "Orders, form submissions and bookings show up here.")
        } else {
          List(rows) { row in
            Button { openNotification(row, model: model, navigation: navigation) } label: { NotificationRow(row: row) }
              .buttonStyle(.plain)
              .aglynListRow()
          }
          .aglynListBackground()
        }
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    }
    .navigationTitle("Notifications")
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken)") {
      feed.start(reader: model.reader, uid: model.auth?.user?.uid, count: 50)
    }
    .refreshable { model.refresh() }
  }
}
