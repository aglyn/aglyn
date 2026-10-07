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
  /// The catalog type (`content.order`, `billing.invoice`, …), which picks the row's glyph.
  let type: String?
  let createdAt: Date?

  /// The row's level as a theme tone: the level its emitter stamped, else
  /// its type's level from the catalog, as the console's bell reads it.
  var tone: AglynTone { Self.tone(NotificationCatalog.shared.level(stamped: level, type: type)) }

  static func tone(_ level: String?) -> AglynTone {
    switch level {
    case "critical", "error": .error
    case "warning": .warning
    case "success": .success
    case "neutral": .neutral
    default: .info
    }
  }

  /// A notification type's glyph, by the catalog's type families (the
  /// Android shell's `notificationIcon` draws the same families).
  static func symbol(_ type: String?) -> String {
    guard let type else { return "bell" }
    switch type {
    case _ where type.hasPrefix("billing."): return "creditcard"
    case _ where type.hasPrefix("team."): return "person.2"
    case "content.formSubmission": return "tray"
    case "content.booking": return "calendar"
    case "content.order": return "bag"
    case "content.lowStock": return "shippingbox"
    case _ where type.hasPrefix("content.task"): return "checklist"
    case "content.contactAssigned", "content.leadAssigned": return "person.crop.circle.badge.plus"
    case _ where type.hasSuffix("Digest"): return "chart.bar.xaxis"
    case _ where type.hasPrefix("content.aiJob"): return "sparkles"
    case _ where type.hasPrefix("marketplace."): return "star"
    case _ where type.hasPrefix("support."): return "lifepreserver"
    case _ where type.hasPrefix("system."): return "shield"
    default: return "bell"
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
            read: $0.bool("read") == true, level: $0.string("level"), type: $0.string("type"), createdAt: $0.date("createdAt"))
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

  var body: some View {
    ActivityRow(
      row.title, subtitle: row.body, time: row.createdAt.map { relativeTime($0) }, systemImage: FeedNotification.symbol(row.type),
      tone: row.tone, unread: !row.read)
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
