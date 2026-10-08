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
  /// The workspace and site it is about, which opening it switches to.
  var orgID: String? = nil
  var hostID: String? = nil
  /// The invitee's own invitation: opening it answers the invite instead of following `link`.
  var inviteID: String? = nil

  init(_ doc: FirestoreDocument) {
    id = doc.id
    title = doc.string("title") ?? ""
    body = doc.string("body")
    link = doc.string("link")
    // `readAt` is what the console's Status column draws; `read` is what its filter reads.
    read = doc.bool("read") == true || (doc.data["readAt"] != nil && !(doc.data["readAt"] is NSNull))
    level = doc.string("level")
    type = doc.string("type")
    createdAt = doc.date("createdAt")
    orgID = doc.string("orgId")
    hostID = doc.string("hostId")
    inviteID = doc.string("inviteId")
  }

  /// The row's level: the level its emitter stamped, else its type's level
  /// from the catalog, as the console's bell reads it.
  var resolvedLevel: String { NotificationCatalog.shared.level(stamped: level, type: type) }
  var tone: AglynTone { Self.tone(resolvedLevel) }

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

/// The feed's Status filter, served by the query's `read` equality.
enum NotificationStatusFilter: String, CaseIterable, Identifiable {
  case all, new, read
  var id: String { rawValue }
  var label: String {
    switch self {
    case .all: "All"
    case .new: "New"
    case .read: "Read"
    }
  }
  var read: Bool? {
    switch self {
    case .all: nil
    case .new: false
    case .read: true
    }
  }
}

struct NotificationFilter: Equatable {
  var status: NotificationStatusFilter = .all
  var types: Set<String> = []

  /// Firestore's cap on an `in` filter; a pick past it is refused whole, as the console's.
  static let typePickMax = 30
  var isDefault: Bool { self == NotificationFilter() }
}

enum NotificationFeedQuery {
  /// The console feed's page size.
  static let page = 25
  /// The newest notifications "Mark all read" settles in one go.
  static let markAllWindow = 200

  /// The feed's query for a filter: `limit` rows plus a probe row that says there is more.
  static func make(uid: String, filter: NotificationFilter, limit: Int) -> FirestoreQuery {
    var equals: [(field: String, value: Any)] = []
    var filters: [ListQueryConstraint] = []
    switch filter.types.count {
    case 0: break
    case 1: equals.append(("type", filter.types.first!))
    default: filters.append(ListQueryConstraint(path: "type", op: .in, value: Array(filter.types.sorted().prefix(NotificationFilter.typePickMax))))
    }
    if let read = filter.status.read { equals.append(("read", read)) }
    return FirestoreQuery(
      ["users", uid, "notifications"], equals: equals, filters: filters,
      order: [.init("createdAt", descending: true)], limit: limit + 1)
  }
}

/// The person's notifications: the same `users/{uid}/notifications` feed the
/// console's bell and its "All notifications" page read, newest first, under
/// the same owner-only rules.
@MainActor
@Observable
final class NotificationFeed {
  private(set) var rows: [FeedNotification]?
  private(set) var failed = false
  private(set) var hasMore = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(reader: FirestoreReader?, uid: String?, count: Int, filter: NotificationFilter = NotificationFilter()) {
    listener?.remove()
    guard let reader, let uid else { return }
    listener = reader.listen(NotificationFeedQuery.make(uid: uid, filter: filter, limit: count)) { [weak self] result in
      switch result {
      case .success(let docs):
        self?.failed = false
        self?.hasMore = docs.count > count
        self?.rows = docs.prefix(count).map(FeedNotification.init)
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

enum NotificationActions {
  /// Marks one notification read the way the console does: `read` beside `readAt`.
  @MainActor
  static func markRead(_ id: String, model: AppModel) async throws {
    guard let uid = model.auth?.user?.uid, let reader = model.reader else { return }
    try await reader.setDocument(
      ["users", uid, "notifications", id], ["read": true, "readAt": FirestoreSentinel.serverTimestamp], merge: true)
  }

  /// "Mark all read": the newest 200 that are not read yet. Returns how many.
  @MainActor
  static func markAllRead(model: AppModel) async throws -> Int {
    guard let uid = model.auth?.user?.uid, let reader = model.reader else { return 0 }
    let docs = try await reader.readOnce(
      FirestoreQuery(
        ["users", uid, "notifications"], order: [.init("createdAt", descending: true)],
        limit: NotificationFeedQuery.markAllWindow))
    let unread = docs.map(FeedNotification.init).filter { !$0.read }
    for row in unread { try await markRead(row.id, model: model) }
    return unread.count
  }
}

/// Follows a notification: onto the workspace and site it is about, then its
/// link; marks it read the way the console does.
@MainActor
func openNotification(_ row: FeedNotification, model: AppModel, navigation: ShellNavigation) {
  if !row.read { Task { try? await NotificationActions.markRead(row.id, model: model) } }
  if row.inviteID != nil, row.orgID != nil {
    navigation.select(.notifications)
    navigation.pendingInvite = row
    return
  }
  if let workspace = model.workspace {
    let orgID = row.orgID ?? workspace.sites.first { $0.id == row.hostID }?.orgID
    if let orgID, orgID != workspace.org?.id || (row.hostID != nil && row.hostID != workspace.site?.id) {
      workspace.select(orgID: orgID, hostID: row.hostID ?? (orgID == workspace.org?.id ? workspace.site?.id : nil))
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
  @State private var filter = NotificationFilter()
  @State private var shown = NotificationFeedQuery.page
  @State private var selection: FeedNotification.ID?
  @State private var markingAll = false
  @State private var notice: (String, AglynTone)?
  @State private var pickingTypes = false

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        ListDetailLayout {
          list(wide: true)
        } detail: {
          if let row = feed.rows?.first(where: { $0.id == selection }) {
            NotificationDetail(row: row)
          } else {
            AglynEmptyState("Pick a notification to read it here", systemImage: "bell")
          }
        }
      } else {
        list(wide: false)
      }
    }
    .navigationTitle("Notifications")
    .toolbar { toolbar }
    .task(id: "\(model.auth?.user?.uid ?? ""):\(model.refreshToken):\(filter.status.rawValue):\(filter.types.sorted()):\(shown)") {
      feed.start(reader: model.reader, uid: model.auth?.user?.uid, count: shown, filter: filter)
    }
    .onChange(of: filter) { shown = NotificationFeedQuery.page }
    .onDisappear { feed.stop() }
    .refreshable { model.refresh() }
    .sheet(isPresented: $pickingTypes) {
      NotificationTypePicker(picked: filter.types) { filter.types = $0 }
    }
    .sheet(item: Binding(get: { navigation.pendingInvite }, set: { navigation.pendingInvite = $0 })) { row in
      InviteReviewSheet(row: row)
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Button {
        markAll()
      } label: {
        Label(markingAll ? "Marking…" : "Mark all read", systemImage: "checkmark.circle")
      }
      .disabled(markingAll)
      .accessibilityIdentifier("notifications-mark-all")
    }
    ToolbarItem(placement: .secondaryAction) {
      NavigationLink {
        NotificationSettingsView()
      } label: {
        Label("Notification settings", systemImage: "gearshape")
      }
      .accessibilityIdentifier("notifications-settings")
    }
  }

  private func markAll() {
    markingAll = true
    notice = nil
    Task {
      do {
        let count = try await NotificationActions.markAllRead(model: model)
        notice = (count == 0 ? "Everything was already read." : "Marked \(count) read.", .success)
      } catch {
        notice = ("Could not mark them read. Check the connection and try again.", .error)
      }
      markingAll = false
    }
  }

  private var filterBar: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(NotificationStatusFilter.allCases) { status in
          AglynChoiceChip(status.label, selected: filter.status == status) { filter.status = status }
            .accessibilityIdentifier("notifications-status-\(status.rawValue)")
        }
        Divider().frame(height: 20)
        AglynChoiceChip(typesLabel, systemImage: "line.3.horizontal.decrease", selected: !filter.types.isEmpty) {
          pickingTypes = true
        }
        .accessibilityIdentifier("notifications-types")
        if !filter.types.isEmpty {
          Button("Clear") { filter.types = [] }.buttonStyle(.borderless)
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  private var typesLabel: String {
    switch filter.types.count {
    case 0: "All types"
    case 1: NotificationCatalog.shared.entry(filter.types.first)?.label ?? "1 type"
    default: "\(filter.types.count) types"
    }
  }

  @ViewBuilder
  private func list(wide: Bool) -> some View {
    VStack(spacing: 0) {
      filterBar
      if let (text, tone) = notice {
        AglynNotice(text, tone: tone) { notice = nil }.padding(.horizontal, AglynSpace.two)
      }
      Group {
        if let rows = feed.rows {
          if feed.failed {
            AglynEmptyState("Could not load your notifications", systemImage: "exclamationmark.triangle")
          } else if rows.isEmpty {
            AglynEmptyState(
              filter.isDefault ? "You're all caught up" : "Nothing matches these filters",
              systemImage: "bell",
              message: filter.isDefault
                ? "New orders, bookings, form entries and alerts show up here." : "Clear a filter to see more."
            ) {
              if !filter.isDefault { Button("Clear filters") { filter = NotificationFilter() } }
            }
          } else {
            List(selection: wide ? $selection : nil) {
              ForEach(rows) { row in
                rowView(row, wide: wide)
              }
              if feed.hasMore {
                Button("Show more") { shown += NotificationFeedQuery.page }
                  .frame(maxWidth: .infinity)
                  .accessibilityIdentifier("notifications-more")
              }
            }
            .onChange(of: selection) { _, id in
              if let row = rows.first(where: { $0.id == id }), !row.read {
                Task { try? await NotificationActions.markRead(row.id, model: model) }
              }
            }
            .aglynListBackground()
            .accessibilityIdentifier("notifications-list")
          }
        } else {
          List { SkeletonRows(count: 6) }.aglynListBackground()
        }
      }
      .frame(maxHeight: .infinity)
    }
  }

  @ViewBuilder
  private func rowView(_ row: FeedNotification, wide: Bool) -> some View {
    Group {
      if wide {
        NotificationRow(row: row).tag(row.id)
      } else {
        // A phone follows the link at once, as the console's bell does.
        Button { openNotification(row, model: model, navigation: navigation) } label: { NotificationRow(row: row) }
          .buttonStyle(.plain)
      }
    }
    .aglynListRow()
    .accessibilityIdentifier("notification-\(row.id)")
    .swipeActions(edge: .leading) {
      if !row.read {
        Button {
          Task { try? await NotificationActions.markRead(row.id, model: model) }
        } label: {
          Label("Mark read", systemImage: "checkmark")
        }
        .tint(AglynColor.tint)
      }
    }
    .contextMenu {
      if !row.read {
        Button("Mark read", systemImage: "checkmark") {
          Task { try? await NotificationActions.markRead(row.id, model: model) }
        }
      }
      if row.link != nil || row.inviteID != nil {
        Button("Open", systemImage: "arrow.up.forward") { openNotification(row, model: model, navigation: navigation) }
      }
    }
  }
}

/// One notification read in full beside the list on iPad and Mac.
struct NotificationDetail: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let row: FeedNotification

  var body: some View {
    let catalog = NotificationCatalog.shared
    let workspace = [
      row.orgID.flatMap { id in model.workspace?.orgs.first { $0.id == id }?.name },
      row.hostID.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name },
    ].compactMap { $0 }.joined(separator: " · ")
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        HStack(spacing: AglynSpace.one) {
          StatusChip(catalog.levels.first { $0.id == row.resolvedLevel }?.label ?? "Info", tone: row.tone)
          if let label = catalog.entry(row.type)?.label { StatusChip(label) }
          if !row.read { StatusChip("New", tone: .info) }
        }
        Text(row.title).font(AglynFont.title).accessibilityAddTraits(.isHeader)
        if let date = row.createdAt {
          Text(relativeTime(date)).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if !workspace.isEmpty { Text(workspace).font(AglynFont.strongSubheadline).foregroundStyle(.secondary) }
        if let body = row.body { Text(body).font(AglynFont.body) }
        Divider()
        if row.inviteID != nil, row.orgID != nil {
          Button("Review the invitation") { navigation.pendingInvite = row }.buttonStyle(.borderedProminent)
        } else if row.link != nil {
          Button("Open") { openNotification(row, model: model, navigation: navigation) }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("notification-open")
        } else {
          Text("Nothing to open for this one.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
      }
      .padding(AglynSpace.three)
      .frame(maxWidth: 720, alignment: .leading)
      .aglynCardSurface()
      .padding(AglynSpace.two)
      .frame(maxWidth: .infinity)
    }
    .aglynListBackground()
    .accessibilityIdentifier("notification-detail")
  }
}

/// Which types the feed shows: at most thirty, grouped by category.
struct NotificationTypePicker: View {
  @Environment(\.dismiss) private var dismiss
  @State var picked: Set<String>
  let onApply: (Set<String>) -> Void

  var body: some View {
    NavigationStack {
      List {
        ForEach(NotificationCatalog.shared.categories) { category in
          Section(category.label) {
            ForEach(category.types) { entry in
              Toggle(entry.label, isOn: Binding(
                get: { picked.contains(entry.type) },
                set: { on in if on { picked.insert(entry.type) } else { picked.remove(entry.type) } }))
                .accessibilityIdentifier("type-\(entry.type)")
            }
          }
        }
      }
      .navigationTitle("Show types")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Show") {
            onApply(picked)
            dismiss()
          }
          .disabled(picked.count > NotificationFilter.typePickMax)
        }
        if picked.count > NotificationFilter.typePickMax {
          ToolbarItem(placement: .status) { Text("Pick at most \(NotificationFilter.typePickMax) types.").foregroundStyle(AglynColor.error) }
        }
      }
    }
    .frame(minWidth: 360, minHeight: 480)
  }
}

/// The invitee's own invitation: accept or decline through `/api/orgs/invites`,
/// as the console's dialog does.
struct InviteReviewSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let row: FeedNotification
  @State private var busy = false
  @State private var error: String?
  @State private var confirmDecline = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(row.title).font(AglynFont.headline)
          if let body = row.body { Text(body).foregroundStyle(.secondary) }
        }
        if let error { Section { AglynNotice(error, tone: .error) } }
        Section {
          Button("Accept") { respond("accept") }
            .disabled(busy)
            .accessibilityIdentifier("invite-accept")
          Button("Decline", role: .destructive) { confirmDecline = true }
            .disabled(busy)
            .accessibilityIdentifier("invite-decline")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Invitation")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { dismiss() } } }
      .confirmationDialog("Decline this invitation?", isPresented: $confirmDecline) {
        Button("Decline", role: .destructive) { respond("decline") }
      }
    }
    .frame(minWidth: 360, minHeight: 320)
  }

  private func respond(_ action: String) {
    guard let api = model.api, let orgID = row.orgID, let inviteID = row.inviteID else { return }
    busy = true
    error = nil
    Task {
      do {
        try await api.request(
          "/api/orgs/invites", method: .post,
          body: .object(["orgId": .string(orgID), "action": .string(action), "inviteId": .string(inviteID)]))
        if action == "accept" { model.workspace?.selectOrg(orgID) }
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
      busy = false
    }
  }
}
