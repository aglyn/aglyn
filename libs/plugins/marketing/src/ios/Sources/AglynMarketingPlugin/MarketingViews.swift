// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

func problemText(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
}

/// The site's role for this member, and the workspace's plan, which gate what Marketing offers.
@MainActor
@Observable
final class MarketingAccess {
  @ObservationIgnored let host = LiveDocument()
  @ObservationIgnored let org = LiveDocument()
  private var uid = ""

  func start(_ context: NativePluginContext) {
    uid = context.uid
    if let hostID = context.hostID { host.start(context.firestore, ["hosts", hostID]) }
    if let orgID = context.orgID { org.start(context.firestore, ["orgs", orgID]) }
  }

  func stop() {
    host.stop()
    org.stop()
  }

  var role: String? { (host.document?.data["memberRoles"] as? [String: Any])?[uid] as? String }
  var canEdit: Bool { ["owner", "admin", "editor"].contains(role ?? "") }
  func carries(_ feature: String) -> Bool { planFeatureCarried(org.document?.data, feature) }
}

/// The Marketing hub: the console's sections as a bar over the chosen one.
struct MarketingHubScreen: View {
  let context: NativePluginContext
  @State var section: MarketingSection
  var initial: String?
  @State private var access = MarketingAccess()

  var body: some View {
    VStack(spacing: 0) {
      AglynSectionBar(MarketingSection.allCases, selection: $section, label: \.label, systemImage: \.symbol)
      Group {
        if let orgID = context.orgID, let hostID = context.hostID {
          let actions = MarketingActions(context: context, orgID: orgID, hostID: hostID)
          switch section {
          case .overview: OverviewSection(context: context, actions: actions) { section = $0 }
          case .campaigns: CampaignsSection(context: context, actions: actions, access: access, initial: initial)
          case .conversions: ConversionsSection(context: context, actions: actions)
          case .overlays:
            if access.org.ready && !access.carries("marketingOverlays") {
              AglynEmptyState(
                "Overlays come with Starter", systemImage: "rectangle.on.rectangle",
                message: "Announcement bars and popups are included from the Starter plan. Change the plan under Billing to use them.")
            } else {
              OverlaysSection(context: context, actions: actions, access: access)
            }
          case .experiments:
            if access.org.ready && !access.carries("abTesting") {
              AglynEmptyState(
                "A/B testing comes with Business", systemImage: "flask",
                message: "Testing two versions of a page or an email is included from the Business plan.")
            } else {
              ExperimentsSection(context: context, actions: actions, access: access)
            }
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(AglynColor.page)
    .navigationTitle(section == .overview ? "Marketing" : section.label)
    .task(id: context.hostID) { access.start(context) }
    .onDisappear { access.stop() }
  }
}

// MARK: Overview

struct OverviewSection: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let open: (MarketingSection) -> Void
  @State private var overlays = LiveQueryList(pageSize: 51, map: overlayRow)
  @State private var sends = LiveQueryList(pageSize: 200) { $0 }
  @State private var experiments = LiveQueryList(pageSize: 100, map: experimentRow)

  var body: some View {
    let now = nowMs()
    let live = overlays.rows.filter { $0.data["deletedAt"] == nil && overlayStatus(enabled: $0.enabled, startAtMs: $0.startAtMs, endAtMs: $0.endAtMs, nowMs: now) == "live" }
    let stats = sends.rows.map { $0.data["stats"] as? [String: Any] ?? [:] }
    let sum: (String) -> Int = { key in stats.reduce(0) { $0 + (($1[key] as? NSNumber)?.intValue ?? 0) } }
    let scheduled = sends.rows.filter { $0.string("status") == "scheduled" }.count
    let more = sends.hasMore ? "+" : ""
    ScrollView {
      AglynCardGrid {
        MetricCard("Live overlays", systemImage: "rectangle.on.rectangle", tone: .info, value: overlays.ready ? "\(live.count)\(overlays.hasMore ? "+" : "")" : nil,
          caption: "\(grouped(overlays.rows.reduce(0) { $0 + $1.impressions })) views · \(grouped(overlays.rows.reduce(0) { $0 + $1.clicks })) clicks",
          actionLabel: "Open overlays") { open(.overlays) }
        MetricCard("Emails sent", systemImage: "paperplane", tone: .success, value: sends.ready ? "\(grouped(sum("sent")))\(more)" : nil,
          caption: "\(grouped(sum("opens"))) opens · \(grouped(sum("clicks"))) clicks", actionLabel: "Open campaigns") { open(.campaigns) }
        if scheduled > 0 {
          MetricCard("Scheduled sends", systemImage: "calendar", tone: .warning, value: "\(scheduled)", caption: "waiting to go out", actionLabel: "Open campaigns") {
            open(.campaigns)
          }
        }
        MetricCard("Experiments", systemImage: "flask", tone: .neutral,
          value: experiments.ready ? "\(experiments.rows.filter { $0.status == "running" }.count)" : nil,
          caption: "running · \(experiments.rows.filter { $0.winnerVariantID != nil }.count) decided", actionLabel: "Open A/B testing") { open(.experiments) }
      }
      .padding(AglynSpace.two)
    }
    .task {
      let hostID = actions.hostID, orgID = actions.orgID
      overlays.show(context.firestore) { FirestoreQuery(["hosts", hostID, "overlays"], order: [.init("name")], limit: $0) }
      sends.show(context.firestore) {
        FirestoreQuery(
          ["orgs", orgID, "campaigns"], filters: [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: ["host:\(hostID)"])],
          order: [.init("createdAtMs", descending: true)], limit: $0)
      }
      experiments.show(context.firestore) { FirestoreQuery(["hosts", hostID, "experiments"], limit: $0) }
    }
    .onDisappear {
      overlays.stop()
      sends.stop()
      experiments.stop()
    }
  }
}

func grouped(_ value: Int) -> String {
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.locale = Locale(identifier: "en_US")
  return formatter.string(from: NSNumber(value: value)) ?? String(value)
}

// MARK: Campaigns

struct CampaignsSection: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let access: MarketingAccess
  var initial: String?
  @State private var list = LiveQueryList(pageSize: 25, map: campaignRow)
  @State private var sends = LiveQueryList(pageSize: 50) { $0 }
  @State private var lists = LiveQueryList(pageSize: 50) { (id: $0.id, name: $0.string("name") ?? $0.id) }
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var creating = false

  var body: some View {
    let rollups = campaignRollups(sends.rows)
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          pane(rollups, selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          if let selection {
            CampaignDetail(context: context, actions: actions, access: access, campaignID: selection).id(selection)
          } else {
            AglynEmptyState("Pick a campaign to see its emails", systemImage: "megaphone").frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      } else {
        pane(rollups, selectable: false)
      }
    }
    .searchable(text: $searchText, prompt: "Search campaigns")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if access.canEdit {
        ToolbarItem(placement: .primaryAction) { Button("New campaign", systemImage: "plus") { creating = true }.accessibilityIdentifier("campaign-new") }
      }
    }
    .task(id: search) {
      if selection == nil { selection = initial }
      let orgID = actions.orgID, hostID = actions.hostID, search = search
      list.show(context.firestore) { campaignsQuery(orgID: orgID, hostID: hostID, search: search, limit: $0) }
      lists.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "lists"], limit: 50) }
    }
    .task(id: list.rows.map(\.id)) {
      let ids = Array(list.rows.map(\.id).prefix(30)), orgID = actions.orgID, hostID = actions.hostID
      sends.show(context.firestore) { limit in
        ids.isEmpty
          ? nil
          : FirestoreQuery(
            ["orgs", orgID, "campaigns"], equals: [("hostId", hostID)],
            filters: [ListQueryConstraint(path: "emailCampaignId", op: .in, value: ids)], limit: limit)
      }
    }
    .onDisappear {
      list.stop()
      sends.stop()
      lists.stop()
    }
    .sheet(isPresented: $creating) {
      CampaignSheet(campaign: nil, lists: lists.rows, context: context) { name, start, end, listIDs, topic, _ in
        try await actions.createCampaign(name: name, startAtMs: start, endAtMs: end, listIDs: listIDs, topicID: topic)
      }
    }
  }

  @ViewBuilder
  private func pane(_ rollups: [String: CampaignRollup], selectable: Bool) -> some View {
    let listNames = Dictionary(uniqueKeysWithValues: lists.rows.map { ($0.id, $0.name) })
    if selectable && list.ready && list.failure == nil && !list.rows.isEmpty {
      List(selection: $selection) {
        ForEach(list.rows) { row in CampaignRowView(row: row, rollup: rollups[row.id], listNames: listNames).tag(row.id).aglynListRow() }
        if list.hasMore { Button("Show more") { list.loadMore() }.frame(maxWidth: .infinity) }
      }
      .aglynListBackground()
    } else {
      AglynLiveList(
        rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load campaigns",
        emptyTitle: search.isEmpty ? "No campaigns yet" : "No campaigns match",
        emptyMessage: "A campaign gathers the emails that go to the same lists over a window of time.", systemImage: "megaphone",
        onMore: { list.loadMore() }, onRetry: { list.retry() }
      ) { row in
        NavigationLink {
          CampaignDetail(context: context, actions: actions, access: access, campaignID: row.id)
        } label: {
          CampaignRowView(row: row, rollup: rollups[row.id], listNames: listNames)
        }
      }
    }
  }
}

struct CampaignRowView: View {
  let row: CampaignRow
  let rollup: CampaignRollup?
  let listNames: [String: String]

  var body: some View {
    let lists = row.listIDs.map { listNames[$0] ?? $0 }.joined(separator: ", ")
    let emails = rollup.map { "\($0.emails) email\($0.emails == 1 ? "" : "s") · \(grouped($0.sent)) sent · \(grouped($0.opens)) opens" }
    AglynRow(row.name, subtitle: [lists.isEmpty ? nil : lists, emails ?? "No emails yet"].compactMap { $0 }.joined(separator: " · "), systemImage: "megaphone") {
      StatusChip(row.window.label, tone: row.window == .running ? .success : row.window == .upcoming ? .info : .neutral)
    }
    .accessibilityIdentifier("campaign-\(row.id)")
  }
}

/// One campaign: its window, lists and emails; edit and delete.
struct CampaignDetail: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let access: MarketingAccess
  let campaignID: String
  @Environment(\.dismiss) private var dismiss
  @State private var doc = LiveDocument()
  @State private var emails = LiveQueryList(pageSize: 25) { $0 }
  @State private var lists = LiveQueryList(pageSize: 50) { (id: $0.id, name: $0.string("name") ?? $0.id) }
  @State private var editing = false
  @State private var confirmDelete = false
  @State private var notice: String?

  var body: some View {
    Group {
      if let document = doc.document {
        let row = campaignRow(document)
        let listNames = Dictionary(uniqueKeysWithValues: lists.rows.map { ($0.id, $0.name) })
        Form {
          if let notice { AglynNotice(notice, tone: .error) { self.notice = nil } }
          Section {
            HStack {
              Text(row.name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
              Spacer()
              StatusChip(row.window.label, tone: row.window == .running ? .success : .neutral)
            }
            PropertyRow("Starts", row.startAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000).formatted(date: .abbreviated, time: .omitted) })
            PropertyRow("Ends", row.endAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000).formatted(date: .abbreviated, time: .omitted) })
            PropertyRow("Lists", row.listIDs.map { listNames[$0] ?? $0 }.joined(separator: ", "))
            PropertyRow("Unsubscribe header", row.listUnsubscribe ? "On" : "Off")
          }
          Section("Emails") {
            if emails.rows.isEmpty { Text(emails.ready ? "No emails in this campaign yet." : "Loading…").foregroundStyle(.secondary) }
            ForEach(emails.rows, id: \.id) { send in
              let stats = send.data["stats"] as? [String: Any]
              Button {
                context.navigate("email.messages", ["message": send.id])
              } label: {
                AglynRow(
                  send.string("subject").flatMap { $0.isEmpty ? nil : $0 } ?? "(No subject)",
                  subtitle: "\((send.string("status") ?? "draft").capitalized) · \(grouped((stats?["sent"] as? NSNumber)?.intValue ?? 0)) sent · \(grouped((stats?["opens"] as? NSNumber)?.intValue ?? 0)) opens",
                  systemImage: "envelope")
              }
              .buttonStyle(.plain)
            }
            if emails.hasMore { Button("Show more") { emails.loadMore() } }
            Button("Write an email in this campaign", systemImage: "square.and.pencil") {
              context.navigate("email.messages", ["campaign": campaignID])
            }
          }
          Section {
            Button("See its conversions", systemImage: "target") { context.navigate("marketing.conversions", ["campaign": campaignID]) }
          }
        }
        .formStyle(.grouped)
        .aglynListBackground()
        .navigationTitle(row.name)
        .toolbar {
          if access.canEdit {
            ToolbarItem(placement: .primaryAction) {
              Menu {
                Button("Edit", systemImage: "pencil") { editing = true }
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
              } label: {
                Label("Campaign", systemImage: "ellipsis.circle")
              }
            }
          }
        }
        .sheet(isPresented: $editing) {
          CampaignSheet(campaign: row, lists: lists.rows, context: context) { name, start, end, listIDs, topic, unsubscribe in
            try await actions.updateCampaign(
              campaignID, name: name, startAtMs: start, endAtMs: end, listIDs: listIDs, topicID: topic, listUnsubscribe: unsubscribe)
          }
        }
        .confirmationDialog("Delete \(row.name)?", isPresented: $confirmDelete, titleVisibility: .visible) {
          Button("Delete", role: .destructive) {
            Task {
              do {
                try await actions.deleteCampaign(campaignID)
                dismiss()
              } catch {
                notice = problemText(error)
              }
            }
          }
        } message: {
          Text("The campaign goes. Its emails stay, with their reports, as single sends.")
        }
      } else if doc.ready {
        AglynEmptyState("This campaign is gone", systemImage: "megaphone")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    }
    .task(id: campaignID) {
      let orgID = actions.orgID, hostID = actions.hostID
      doc.start(context.firestore, ["orgs", orgID, "emailCampaigns", campaignID])
      emails.show(context.firestore) { campaignEmailsQuery(orgID: orgID, hostID: hostID, campaignID: campaignID, limit: $0) }
      lists.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "lists"], limit: 50) }
    }
    .onDisappear {
      doc.stop()
      emails.stop()
      lists.stop()
    }
  }
}

/// New or edit: a name, an optional window, its lists and its topic.
struct CampaignSheet: View {
  let campaign: CampaignRow?
  let lists: [(id: String, name: String)]
  let context: NativePluginContext
  let save: (String, Int64?, Int64?, [String], String, Bool) async throws -> Void
  @State private var name = ""
  @State private var dated = false
  @State private var start = Date()
  @State private var end = Date().addingTimeInterval(30 * 86_400)
  @State private var picked: Set<String> = []
  @State private var topic = ""
  @State private var unsubscribe = true
  @State private var topics = LiveQueryList(pageSize: 50) { (id: $0.id, name: $0.string("name") ?? $0.id, archived: $0.bool("archived") == true) }
  @State private var seeded = false

  var body: some View {
    AglynFormSheet(campaign == nil ? "New campaign" : "Edit campaign", confirm: campaign == nil ? "Create" : "Save",
      canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty && (!dated || end >= start), save: {
        try await save(
          name.trimmingCharacters(in: .whitespaces), dated ? Int64(start.timeIntervalSince1970 * 1000) : nil,
          dated ? Int64(end.timeIntervalSince1970 * 1000) : nil, lists.map(\.id).filter(picked.contains), topic, unsubscribe)
      }
    ) {
      Section {
        TextField("Name", text: $name).accessibilityIdentifier("campaign-name")
        Toggle("Runs over dates", isOn: $dated)
        if dated {
          DatePicker("Starts", selection: $start, displayedComponents: .date)
          DatePicker("Ends", selection: $end, in: start..., displayedComponents: .date)
        }
      }
      Section("Lists") {
        if lists.isEmpty { Text("No lists yet. Make one under Emails, Audiences.").foregroundStyle(.secondary) }
        ForEach(lists, id: \.id) { list in
          Toggle(list.name, isOn: Binding(get: { picked.contains(list.id) }, set: { on in if on { picked.insert(list.id) } else { picked.remove(list.id) } }))
        }
      }
      Section {
        Picker("Topic", selection: $topic) {
          Text("Marketing").tag("")
          ForEach(topics.rows.filter { !$0.archived || $0.id == topic }, id: \.id) { Text($0.name).tag($0.id) }
        }
        if campaign != nil { Toggle("One-click unsubscribe header", isOn: $unsubscribe) }
      }
    }
    .task {
      if let orgID = context.orgID { topics.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "emailTopics"], limit: 50) } }
      guard !seeded, let campaign else { return }
      seeded = true
      name = campaign.name
      dated = campaign.startAtMs != nil || campaign.endAtMs != nil
      if let s = campaign.startAtMs { start = Date(timeIntervalSince1970: Double(s) / 1000) }
      if let e = campaign.endAtMs { end = Date(timeIntervalSince1970: Double(e) / 1000) }
      picked = Set(campaign.listIDs)
      topic = campaign.topicID ?? ""
      unsubscribe = campaign.listUnsubscribe
    }
    .onDisappear { topics.stop() }
  }
}

// MARK: Conversions

struct ConversionRow: Identifiable {
  let id: String
  let record: String
  let credited: String
  let convertedAt: Date?
}

func conversionRow(_ doc: FirestoreDocument) -> ConversionRow {
  let channel = doc.string("channel") ?? ""
  let credited: String
  if ["email", "sequence", "page"].contains(channel) {
    credited = doc.string("campaignId") ?? "—"
  } else {
    credited = [doc.string("source"), doc.string("medium"), doc.string("campaign")].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " / ")
  }
  return ConversionRow(id: doc.id, record: doc.string("refId") ?? doc.id, credited: credited.isEmpty ? "—" : credited, convertedAt: dateOf(doc.data["convertedAtMs"]))
}

struct ConversionsSection: View {
  let context: NativePluginContext
  let actions: MarketingActions
  var campaignID: String?
  @State private var kind = "form"
  @State private var channel = "email"
  @State private var list = LiveQueryList(pageSize: 25, map: conversionRow)

  private let kinds = [("form", "Form submissions"), ("lead", "Leads"), ("contact", "Contacts"), ("booking", "Bookings")]

  var body: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          ForEach(kinds, id: \.0) { value, label in AglynChoiceChip(label, selected: kind == value) { kind = value } }
          if campaignID == nil {
            Divider().frame(height: 24)
            AglynChoiceChip("From email", selected: channel == "email") { channel = "email" }
            AglynChoiceChip("From the web", selected: channel == "web") { channel = "web" }
          }
        }
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
      }
      AglynLiveList(
        rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load conversions",
        emptyTitle: "No conversions yet", emptyMessage: "When someone a campaign reached submits a form, books or becomes a lead, it is credited here.",
        systemImage: "target", onMore: { list.loadMore() }, onRetry: { list.retry() }
      ) { row in
        AglynRow(row.record, subtitle: [row.credited, row.convertedAt.map { relativeTime($0) }].compactMap { $0 }.joined(separator: " · "), systemImage: "target")
      }
    }
    .task(id: "\(kind)|\(channel)|\(campaignID ?? "")") {
      let hostID = actions.hostID, kind = kind, channel = channel, campaignID = campaignID
      list.show(context.firestore) {
        FirestoreQuery(
          ["hosts", hostID, "campaignAttributions"],
          equals: [("kind", kind)] + (campaignID.map { [("campaignId", $0 as Any)] } ?? [("channel", channel as Any)]),
          order: [.init("__name__")], limit: $0)
      }
    }
    .onDisappear { list.stop() }
  }
}

// MARK: Overlays

struct OverlaysSection: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let access: MarketingAccess
  @State private var list = LiveQueryList(pageSize: 51, map: overlayRow)
  @State private var editing: OverlayRow?
  @State private var creatingKind: String?
  @State private var deleting: OverlayRow?
  @State private var notice: String?

  var body: some View {
    let rows = list.rows.filter { $0.data["deletedAt"] == nil }.sorted { ($0.order, $0.title.lowercased()) < ($1.order, $1.title.lowercased()) }
    VStack(spacing: 0) {
      if let notice { AglynNotice(notice, tone: .error) { self.notice = nil }.padding(.horizontal, AglynSpace.two) }
      AglynLiveList(
        rows: rows, ready: list.ready, failure: list.failure, hasMore: false, failedTitle: "Could not load overlays",
        emptyTitle: "No overlays yet", emptyMessage: "An announcement bar across the top, or a popup, shown on the pages you pick.",
        systemImage: "rectangle.on.rectangle", onMore: {}, onRetry: { list.retry() }
      ) { row in
        let status = overlayStatus(enabled: row.enabled, startAtMs: row.startAtMs, endAtMs: row.endAtMs, nowMs: nowMs())
        AglynRow(
          row.title, subtitle: "\(row.kind == "bar" ? "Announcement bar" : "Popup") · \(grouped(row.impressions)) views · \(grouped(row.clicks)) clicks",
          systemImage: row.kind == "bar" ? "rectangle.topthird.inset.filled" : "macwindow"
        ) {
          HStack {
            StatusChip(status.capitalized, tone: status == "live" ? .success : status == "scheduled" ? .info : .neutral)
            if access.canEdit {
              Menu {
                Button(row.enabled ? "Turn off" : "Turn on") { run { try await actions.toggleOverlay(row) } }
                Button("Edit", systemImage: "pencil") { editing = row }
                if let index = rows.firstIndex(of: row) {
                  if index > 0 { Button("Move up", systemImage: "arrow.up") { run { try await actions.swapOverlays(row, rows[index - 1]) } } }
                  if index < rows.count - 1 { Button("Move down", systemImage: "arrow.down") { run { try await actions.swapOverlays(row, rows[index + 1]) } } }
                }
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = row }
              } label: {
                Image(systemName: "ellipsis.circle")
              }
              .accessibilityIdentifier("overlay-actions-\(row.id)")
            }
          }
        }
      }
    }
    .toolbar {
      if access.canEdit {
        ToolbarItem(placement: .primaryAction) {
          Menu {
            Button("Announcement bar") { creatingKind = "bar" }
            Button("Popup") { creatingKind = "popup" }
          } label: {
            Label("New overlay", systemImage: "plus")
          }
          .accessibilityIdentifier("overlay-new")
        }
      }
    }
    .task {
      let hostID = actions.hostID
      list.show(context.firestore) { FirestoreQuery(["hosts", hostID, "overlays"], order: [.init("name")], limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(item: $editing) { row in OverlaySheet(kind: row.kind, existing: row, nextOrder: rows.count, actions: actions) }
    .sheet(item: Binding(get: { creatingKind.map { KindPick(id: $0) } }, set: { creatingKind = $0?.id })) { pick in
      OverlaySheet(kind: pick.id, existing: nil, nextOrder: (rows.map(\.order).max() ?? -1) + 1, actions: actions)
    }
    .confirmationDialog("Delete overlay?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
      Button("Delete", role: .destructive) {
        guard let row = deleting else { return }
        run { try await actions.deleteOverlay(row.id) }
      }
    } message: {
      Text("It comes off every page at once.")
    }
  }

  private func run(_ act: @escaping () async throws -> Void) {
    Task {
      do { try await act() } catch { notice = problemText(error) }
    }
  }
}

struct KindPick: Identifiable { let id: String }

/// An overlay's fields: the bar's text and link, or the popup's copy and trigger; its window and pages.
struct OverlaySheet: View {
  let kind: String
  let existing: OverlayRow?
  let nextOrder: Int
  let actions: MarketingActions
  @State private var name = ""
  @State private var enabled = true
  @State private var dated = false
  @State private var start = Date()
  @State private var end = Date().addingTimeInterval(7 * 86_400)
  @State private var paths = ""
  @State private var excluded = ""
  @State private var text = ""
  @State private var href = ""
  @State private var background = ""
  @State private var textColor = ""
  @State private var dismissible = true
  @State private var headline = ""
  @State private var bodyText = ""
  @State private var ctaLabel = ""
  @State private var ctaHref = ""
  @State private var collectEmail = false
  @State private var trigger = "delay"
  @State private var triggerValue = 3.0
  @State private var frequencyDays = 7.0
  @State private var oncePerSession = false
  @State private var seeded = false

  var body: some View {
    AglynFormSheet(existing == nil ? (kind == "bar" ? "New announcement bar" : "New popup") : "Edit overlay",
      canConfirm: kind == "bar" ? !text.trimmingCharacters(in: .whitespaces).isEmpty : !headline.trimmingCharacters(in: .whitespaces).isEmpty,
      save: { try await actions.saveOverlay(existing?.id, fields) }
    ) {
      Section {
        TextField("Name (only you see it)", text: $name)
        Toggle("On", isOn: $enabled)
      }
      if kind == "bar" {
        Section("Bar") {
          TextField("Text", text: $text, axis: .vertical).accessibilityIdentifier("overlay-text")
          TextField("Link", text: $href)
          TextField("Background color", text: $background)
          TextField("Text color", text: $textColor)
          Toggle("Visitors can close it", isOn: $dismissible)
        }
      } else {
        Section("Popup") {
          TextField("Headline", text: $headline).accessibilityIdentifier("overlay-headline")
          TextField("Body", text: $bodyText, axis: .vertical).lineLimit(2...6)
          TextField("Button label", text: $ctaLabel)
          TextField("Button link", text: $ctaHref)
          Toggle("Ask for an email address", isOn: $collectEmail)
        }
        Section("When it opens") {
          Picker("Opens", selection: $trigger) {
            Text("After a delay").tag("delay")
            Text("After scrolling").tag("scroll")
            Text("When leaving").tag("exit")
          }
          if trigger != "exit" {
            Stepper(trigger == "delay" ? "After \(Int(triggerValue)) seconds" : "At \(Int(triggerValue))% scrolled", value: $triggerValue, in: 0...100)
          }
          Stepper("At most every \(Int(frequencyDays)) day\(frequencyDays == 1 ? "" : "s")", value: $frequencyDays, in: 1...365)
          Toggle("Once per visit", isOn: $oncePerSession)
        }
      }
      Section {
        Toggle("Only between dates", isOn: $dated)
        if dated {
          DatePicker("From", selection: $start)
          DatePicker("Until", selection: $end, in: start...)
        }
        TextField("Only on pages (comma separated, * for any)", text: $paths)
        TextField("Never on pages", text: $excluded)
      } header: {
        Text("Where and when")
      }
    }
    .onAppear(perform: seed)
  }

  private func list(_ text: String) -> [String] {
    text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  private var fields: [String: Any] {
    var all: [String: Any] = ["kind": kind, "name": name.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : name.trimmingCharacters(in: .whitespaces) as Any,
      "enabled": enabled, "order": existing?.order ?? nextOrder]
    if dated {
      all["startAtMs"] = Int64(start.timeIntervalSince1970 * 1000)
      all["endAtMs"] = Int64(end.timeIntervalSince1970 * 1000)
    }
    if !list(paths).isEmpty { all["pathPatterns"] = list(paths) }
    if !list(excluded).isEmpty { all["excludePathPatterns"] = list(excluded) }
    if kind == "bar" {
      var bar: [String: Any] = ["text": text.trimmingCharacters(in: .whitespaces), "dismissible": dismissible]
      if !href.isEmpty { bar["href"] = href }
      if !background.isEmpty { bar["backgroundColor"] = background }
      if !textColor.isEmpty { bar["textColor"] = textColor }
      all["bar"] = bar
    } else {
      var popup: [String: Any] = [
        "headline": headline.trimmingCharacters(in: .whitespaces), "collectEmail": collectEmail, "trigger": trigger,
        "triggerValue": Int(triggerValue), "frequencyDays": Int(frequencyDays), "oncePerSession": oncePerSession,
      ]
      if !bodyText.isEmpty { popup["body"] = bodyText }
      if !ctaLabel.isEmpty { popup["ctaLabel"] = ctaLabel }
      if !ctaHref.isEmpty { popup["ctaHref"] = ctaHref }
      for key in ["imageUrl", "imageAlt"] {
        if let value = (existing?.data["popup"] as? [String: Any])?[key] { popup[key] = value }
      }
      all["popup"] = popup
    }
    if let stats = existing?.data["stats"] { all["stats"] = stats }
    if let created = existing?.data["createdAt"] { all["createdAt"] = created }
    return all
  }

  private func seed() {
    guard !seeded else { return }
    seeded = true
    guard let row = existing else { return }
    let data = row.data
    name = row.name ?? ""
    enabled = row.enabled
    if let s = row.startAtMs { start = Date(timeIntervalSince1970: Double(s) / 1000); dated = true }
    if let e = row.endAtMs { end = Date(timeIntervalSince1970: Double(e) / 1000); dated = true }
    paths = (data["pathPatterns"] as? [String] ?? []).joined(separator: ", ")
    excluded = (data["excludePathPatterns"] as? [String] ?? []).joined(separator: ", ")
    let bar = data["bar"] as? [String: Any] ?? [:]
    text = bar["text"] as? String ?? ""
    href = bar["href"] as? String ?? ""
    background = bar["backgroundColor"] as? String ?? ""
    textColor = bar["textColor"] as? String ?? ""
    dismissible = bar["dismissible"] as? Bool ?? true
    let popup = data["popup"] as? [String: Any] ?? [:]
    headline = popup["headline"] as? String ?? ""
    bodyText = popup["body"] as? String ?? ""
    ctaLabel = popup["ctaLabel"] as? String ?? ""
    ctaHref = popup["ctaHref"] as? String ?? ""
    collectEmail = popup["collectEmail"] as? Bool ?? false
    trigger = popup["trigger"] as? String ?? "delay"
    triggerValue = (popup["triggerValue"] as? NSNumber)?.doubleValue ?? 3
    frequencyDays = (popup["frequencyDays"] as? NSNumber)?.doubleValue ?? 7
    oncePerSession = popup["oncePerSession"] as? Bool ?? false
  }
}

// MARK: Experiments

struct ExperimentsSection: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let access: MarketingAccess
  @State private var list = LiveQueryList(pageSize: 25, map: experimentRow)
  @State private var searchText = ""
  @State private var search = ""
  @State private var creating = false

  var body: some View {
    AglynLiveList(
      rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load experiments",
      emptyTitle: search.isEmpty ? "No experiments yet" : "No experiments match",
      emptyMessage: "Show two versions of a page or an email and keep the one that converts better.", systemImage: "flask",
      onMore: { list.loadMore() }, onRetry: { list.retry() }
    ) { row in
      NavigationLink {
        ExperimentDetail(context: context, actions: actions, access: access, experimentID: row.id)
      } label: {
        AglynRow(row.name, subtitle: "\(row.variants.count) versions · \(row.target == "email" ? "Email" : "Page")", systemImage: "flask") {
          StatusChip(experimentStatusLabel(row.status), tone: row.status == "running" ? .success : row.status == "done" ? .info : .neutral)
        }
      }
      .accessibilityIdentifier("experiment-\(row.id)")
    }
    .searchable(text: $searchText, prompt: "Search experiments")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if access.canEdit {
        ToolbarItem(placement: .primaryAction) { Button("New experiment", systemImage: "plus") { creating = true }.accessibilityIdentifier("experiment-new") }
      }
    }
    .task(id: search) {
      let hostID = actions.hostID, search = search
      list.show(context.firestore) { experimentsQuery(hostID, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $creating) { ExperimentSheet(context: context, actions: actions) }
  }
}

struct ExperimentDetail: View {
  let context: NativePluginContext
  let actions: MarketingActions
  let access: MarketingAccess
  let experimentID: String
  @Environment(\.dismiss) private var dismiss
  @State private var doc = LiveDocument()
  @State private var stats = LiveQueryList(pageSize: 10) { $0 }
  @State private var confirmDelete = false
  @State private var notice: String?

  var body: some View {
    Group {
      if let document = doc.document {
        let row = experimentRow(document)
        let byVariant = Dictionary(uniqueKeysWithValues: stats.rows.map { ($0.id, $0.data) })
        let results = experimentResultRows(variants: row.variants, winnerVariantID: row.winnerVariantID, stats: byVariant)
        Form {
          if let notice { AglynNotice(notice, tone: .error) { self.notice = nil } }
          Section {
            HStack {
              Text(row.name).font(AglynFont.title2)
              Spacer()
              StatusChip(experimentStatusLabel(row.status), tone: row.status == "running" ? .success : .neutral)
            }
            PropertyRow("Tests", row.target == "email" ? "An email" : row.target == "section" ? "A section of a page" : "A page")
            PropertyRow("Goal", row.goalEvent)
            if access.canEdit && row.status != "done" {
              HStack {
                if row.status != "running" { Button("Start") { run { try await actions.setExperimentStatus(row, "running") } }.buttonStyle(.borderedProminent) }
                if row.status == "running" { Button("Pause") { run { try await actions.setExperimentStatus(row, "paused") } }.buttonStyle(.bordered) }
              }
            }
          }
          Section("Results") {
            ForEach(results, id: \.variant.id) { result in
              VStack(alignment: .leading, spacing: 4) {
                HStack {
                  Text(result.variant.name ?? result.variant.id).font(AglynFont.headline)
                  if result.winner { StatusChip("Winner", tone: .success) } else if result.leader { StatusChip("Leading", tone: .info) }
                  Spacer()
                  if access.canEdit && row.status != "done" {
                    Button("Pick as winner") { run { try await actions.setExperimentStatus(row, "done", winner: result.variant.id) } }
                      .buttonStyle(.borderless)
                  }
                }
                Text("\(grouped(Int(result.summary.exposures))) saw it · \(grouped(Int(result.summary.conversions))) converted · \(String(format: "%.1f%%", result.summary.rate * 100)) · \(describeVariantComparison(result.comparison))")
                  .font(AglynFont.subheadline).foregroundStyle(.secondary)
              }
            }
          }
        }
        .formStyle(.grouped)
        .aglynListBackground()
        .navigationTitle(row.name)
        .toolbar {
          if access.canEdit {
            ToolbarItem(placement: .primaryAction) {
              Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
            }
          }
        }
        .confirmationDialog("Delete experiment?", isPresented: $confirmDelete, titleVisibility: .visible) {
          Button("Delete", role: .destructive) {
            run {
              try await actions.deleteExperiment(experimentID)
              dismiss()
            }
          }
        } message: {
          Text("Its results go with it, and every visitor sees the page as it is.")
        }
      } else if doc.ready {
        AglynEmptyState("This experiment is gone", systemImage: "flask")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    }
    .task(id: experimentID) {
      let hostID = actions.hostID
      doc.start(context.firestore, ["hosts", hostID, "experiments", experimentID])
      stats.show(context.firestore) { _ in FirestoreQuery(["hosts", hostID, "experiments", experimentID, "stats"], limit: 10) }
    }
    .onDisappear {
      doc.stop()
      stats.stop()
    }
  }

  private func run(_ act: @escaping () async throws -> Void) {
    Task {
      do { try await act() } catch { notice = problemText(error) }
    }
  }
}

/// A new experiment: its name, what it tests (a page, or an email), the page, its versions and its goal.
struct ExperimentSheet: View {
  let context: NativePluginContext
  let actions: MarketingActions
  @State private var name = ""
  @State private var target = "screen"
  @State private var screenID = ""
  @State private var variants = ["A (control)", "B"]
  @State private var goal = "formSubmission"
  @State private var screens = LiveQueryList(pageSize: 200) { $0 }

  private var problem: String? {
    validateExperiment(name: name, target: target, screenID: screenID, nodeID: nil, variantIDs: variants.indices.map { variantID($0) })
  }

  private func variantID(_ index: Int) -> String { String(UnicodeScalar(UInt8(97 + index))) }

  var body: some View {
    AglynFormSheet("New experiment", confirm: "Create", canConfirm: problem == nil, save: {
      try await actions.saveExperiment(
        nil,
        [
          "name": name.trimmingCharacters(in: .whitespaces), "status": "draft", "target": target,
          "screenId": target == "email" ? FirestoreSentinel.delete as Any : screenID as Any,
          "variants": variants.enumerated().map { ["id": variantID($0.offset), "name": $0.element, "weight": 1] },
          "goal": ["event": goal], "endAtMs": NSNull(), "autoWinner": NSNull(),
        ])
    }) {
      Section {
        TextField("Name", text: $name).accessibilityIdentifier("experiment-name")
        Picker("Tests", selection: $target) {
          Text("A page").tag("screen")
          Text("An email").tag("email")
        }
        if target == "screen" {
          Picker("Page", selection: $screenID) {
            Text("Choose a page").tag("")
            ForEach(screens.rows.filter { $0.string("kind") != "email" && $0.data["deletedAt"] == nil }, id: \.id) {
              Text($0.string("displayName") ?? $0.id).tag($0.id)
            }
          }
        }
        Picker("Conversion goal", selection: $goal) {
          ForEach(ExperimentGoalEvents.all, id: \.self) { Text($0).tag($0) }
        }
      }
      Section {
        ForEach(variants.indices, id: \.self) { index in
          TextField("Version \(variantID(index).uppercased())", text: $variants[index])
        }
        if variants.count < 4 { Button("Add a version", systemImage: "plus") { variants.append(variantID(variants.count).uppercased()) } }
        if variants.count > 2 { Button("Remove the last version", role: .destructive) { variants.removeLast() } }
      } header: {
        Text("Versions")
      } footer: {
        Text(problem ?? "Each version's page or email is set up on the website; it starts as a draft.")
      }
    }
    .task {
      let hostID = actions.hostID
      screens.show(context.firestore) { _ in FirestoreQuery(["hosts", hostID, "screens"], limit: 200) }
    }
    .onDisappear { screens.stop() }
  }
}
