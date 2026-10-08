// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE EMAILS HUB (the Kotlin plugin's `EmailHub.kt`): the console's Emails
 * sections, natively. Messages are the site's sends (`EmailSendViews`);
 * Templates are the site's Besigner email designs; Audiences are the
 * workspace's lists and their members; Topics, Suppressions and Sending are
 * the rest of the rail. Reads are the console's own list declarations; every
 * write is the console's own: its routes, or the same Firestore write under
 * the same rules.
 */

enum EmailSection: String, CaseIterable, Identifiable, Hashable {
  case messages, templates, audiences, topics, sending, suppressions
  var id: String { rawValue }
  var screen: String { "email.\(rawValue)" }
  var label: String { rawValue.capitalized }

  var symbol: String {
    switch self {
    case .messages: "envelope"
    case .templates: "paintbrush"
    case .audiences: "person.3"
    case .topics: "tag"
    case .sending: "paperplane"
    case .suppressions: "nosign"
    }
  }
}

let resourcesRoute = "/api/hosts/resources"
let versionsRoute = "/api/hosts/versions"
let eraseRoute = "/api/resources/erase"
let listMembersPreviewRoute = "/api/email/list-members-preview"
let listMembersAddRoute = "/api/email/list-members-add"
let suppressionAddRoute = "/api/email/suppression-add"
let sendingIdentityRoute = "/api/email/sending-identity"
let sendingDomainsRoute = "/api/email/sending-domains"

func searchWords(_ text: String) -> [String]? {
  let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
  return words.isEmpty ? nil : [words]
}

func templatesQuery(_ hostID: String, search: String, limit: Int) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.emailTemplateQuery,
    ListQueryRequest(base: [ListQueryFilter(op: .equal, path: "kind", value: .string("email"))], clauses: [], search: searchWords(search))
  ).firestoreQuery(["hosts", hostID, "screens"], limit: limit)
}

func listsQuery(_ orgID: String, kind: String, search: String, limit: Int) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.emailListQuery,
    ListQueryRequest(
      clauses: kind.isEmpty ? [] : [ListFilterRequest(field: "kind", op: "equals", value: kind)], search: searchWords(search))
  ).firestoreQuery(["orgs", orgID, "lists"], limit: limit)
}

func listMembersQuery(_ orgID: String, listID: String, search: String, limit: Int) -> FirestoreQuery {
  planListQuery(ContractValues.shared.listMemberQuery, ListQueryRequest(clauses: [], search: searchWords(search)))
    .firestoreQuery(["orgs", orgID, "lists", listID, "members"], limit: limit)
}

func suppressionsQuery(_ hostID: String, search: String, limit: Int) -> FirestoreQuery {
  planListQuery(ContractValues.shared.suppressionListQuery, ListQueryRequest(clauses: [], search: searchWords(search)))
    .firestoreQuery(["hosts", hostID, "suppressions"], limit: limit)
}

/// The two documents a new email design is (the console's `emailDesignDocuments` over
/// `emailDesignStarterNodes`, replayed against its answers).
func emailDesignStarterNodes(sectionID: String, textID: String) -> [String: Any] {
  let root = "_@_"
  return [
    root: ["$id": root, "componentId": "div", "nodes": [sectionID]],
    sectionID: ["$id": sectionID, "componentId": "emailSection", "pluginId": "email", "parentId": root, "nodes": [textID]],
    textID: [
      "$id": textID, "componentId": "emailText", "pluginId": "email", "parentId": sectionID,
      "props": ["children": "Hello {{contact.firstName}},", "variant": "body"],
    ],
  ]
}

func emailDesignDocuments(screenID: String, versionID: String, displayName: String, nodes: [String: Any]) -> (
  screen: [String: Any], version: [String: Any]
) {
  (["displayName": displayName, "kind": "email", "versionId": versionID], ["screenId": screenID, "nodes": nodes])
}

/// The Emails hub's writes, as the console makes them.
struct EmailActions {
  let context: NativePluginContext
  let orgID: String
  let hostID: String

  private func post(_ route: String, _ fields: [String: Any?]) async throws -> JSONValue? {
    var all = fields
    if all["hostId"] == nil { all["hostId"] = hostID }
    return try await context.api.request(route, method: .post, body: jsonBody(all))
  }

  /// A new design: the screen, then its first version (`createEmailScreen`). Returns the ids to open.
  func createDesign(_ name: String) async throws -> (screenID: String, versionID: String) {
    let screenID = newResourceID(), versionID = newResourceID()
    let documents = emailDesignDocuments(
      screenID: screenID, versionID: versionID, displayName: name,
      nodes: emailDesignStarterNodes(sectionID: newResourceID(), textID: newResourceID()))
    _ = try await post(resourcesRoute, ["resource": "screen", "id": screenID, "data": documents.screen])
    _ = try await post(versionsRoute, ["kind": "screen", "parentId": screenID, "id": versionID, "data": documents.version])
    return (screenID, versionID)
  }

  func duplicateDesign(_ sourceID: String, name: String) async throws {
    _ = try await post(
      resourcesRoute, ["resource": "emailDesign", "action": "duplicate", "sourceId": sourceID, "name": name, "attemptKey": UUID().uuidString])
  }

  /// The console's `emailTemplateSoftDelete`: stamped deleted, its search keys cleared so lists leave it out.
  func deleteDesign(_ id: String) async throws {
    try await context.writer.merge(
      ["hosts", hostID, "screens", id],
      [
        "deletedAt": Date(), "nameLower": FirestoreSentinel.delete, "nameTokens": FirestoreSentinel.delete,
        "nameReversed": FirestoreSentinel.delete,
      ])
  }

  func createList(_ name: String) async throws {
    var fields = nameSearchFields(name)
    fields["kind"] = "manual"
    fields["createdAt"] = Date()
    try await context.writer.merge(["orgs", orgID, "lists", newResourceID(length: 20)], fields)
  }

  func renameList(_ id: String, _ name: String) async throws {
    try await context.writer.merge(["orgs", orgID, "lists", id], nameSearchFields(name))
  }

  func deleteList(_ id: String) async throws {
    _ = try await post(eraseRoute, ["hostId": nil, "scope": "orgs", "scopeId": orgID, "kind": "lists", "id": id])
  }

  func removeMember(listID: String, memberID: String) async throws {
    try await context.firestore.deleteDocument(["orgs", orgID, "lists", listID, "members", memberID])
  }

  func previewMembers(listID: String, emails: [String]) async throws -> MemberPreview {
    let answer = try await post(listMembersPreviewRoute, ["listId": listID, "emails": emails])
    return MemberPreview(
      verdicts: (answer?["verdicts"]?.arrayValue ?? []).map {
        MemberVerdict(
          input: $0["input"]?.stringValue ?? "", email: $0["email"]?.stringValue, outcome: $0["outcome"]?.stringValue ?? $0["status"]?.stringValue,
          message: $0["message"]?.stringValue ?? $0["error"]?.stringValue)
      },
      optedIn: Int(answer?["optedIn"]?.numberValue ?? 0), needAttestation: Int(answer?["needAttestation"]?.numberValue ?? 0),
      refused: Int(answer?["refused"]?.numberValue ?? 0))
  }

  func addMembers(listID: String, emails: [String], attest: Bool) async throws -> Int {
    let answer = try await post(listMembersAddRoute, ["listId": listID, "emails": emails, "attestConsent": attest])
    return Int(answer?["added"]?.numberValue ?? 0)
  }

  func addTopic(name: String, description: String) async throws {
    try await context.writer.merge(
      ["orgs", orgID, "emailTopics", newResourceID(length: 20)], ["name": name, "description": description, "archived": false])
  }

  func setTopicArchived(_ id: String, _ archived: Bool) async throws {
    try await context.writer.merge(["orgs", orgID, "emailTopics", id], ["archived": archived])
  }

  func addSuppressions(_ emails: [String], note: String) async throws -> JSONValue? {
    try await post(suppressionAddRoute, ["emails": emails, "note": note])
  }

  func removeSuppression(_ id: String) async throws {
    try await context.firestore.deleteDocument(["hosts", hostID, "suppressions", id])
  }

  func identity() async throws -> JSONValue? {
    try await context.api.request(sendingIdentityRoute, query: [("hostId", hostID)])
  }

  func identityAction(_ fields: [String: Any?]) async throws {
    _ = try await post(sendingIdentityRoute, fields)
  }

  func domainAction(_ domain: String, action: String) async throws {
    _ = try await post(sendingDomainsRoute, ["hostId": nil, "orgId": orgID, "domain": domain, "action": action])
  }
}

struct MemberVerdict: Identifiable {
  var id: String { input }
  let input: String
  let email: String?
  let outcome: String?
  let message: String?
}

struct MemberPreview {
  let verdicts: [MemberVerdict]
  let optedIn: Int
  let needAttestation: Int
  let refused: Int
}

/// Addresses typed or pasted: split on commas, semicolons, spaces and lines.
func addressesIn(_ text: String) -> [String] {
  text.split(whereSeparator: { ",; \n\t".contains($0) }).map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
}

/// Whether the member may manage this site's email: an admin or editor of it.
@MainActor
@Observable
final class EmailRoleModel {
  @ObservationIgnored let doc = LiveDocument()
  private var uid = ""

  func start(_ context: NativePluginContext) {
    uid = context.uid
    if let hostID = context.hostID { doc.start(context.firestore, ["hosts", hostID]) }
  }

  var role: String? { (doc.document?.data["memberRoles"] as? [String: Any])?[uid] as? String }
  var canEdit: Bool { ["owner", "admin", "editor"].contains(role ?? "") }
  var canManage: Bool { ["owner", "admin"].contains(role ?? "") }
}

/// The Emails hub: the console's sections as a bar over the chosen one.
struct EmailHubScreen: View {
  let context: NativePluginContext
  @State var section: EmailSection
  var initial: String?

  var body: some View {
    VStack(spacing: 0) {
      AglynSectionBar(EmailSection.allCases, selection: $section, label: \.label, systemImage: \.symbol)
      Group {
        if let orgID = context.orgID, let hostID = context.hostID {
          let actions = EmailActions(context: context, orgID: orgID, hostID: hostID)
          switch section {
          case .messages: EmailsScreen(context: context, initial: initial)
          case .templates: TemplatesSection(context: context, actions: actions)
          case .audiences: AudiencesSection(context: context, actions: actions, initial: initial)
          case .topics: TopicsSection(context: context, actions: actions)
          case .sending: SendingSection(context: context, actions: actions)
          case .suppressions: SuppressionsSection(context: context, actions: actions)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(AglynColor.page)
    .navigationTitle(section == .messages ? "Emails" : section.label)
  }
}

// MARK: Templates

struct TemplateRow: Identifiable {
  let id: String
  let name: String
  let versionID: String?
  let installed: Bool
}

func templateRow(_ doc: FirestoreDocument) -> TemplateRow {
  TemplateRow(
    id: doc.id, name: doc.string("displayName").flatMap { $0.isEmpty ? nil : $0 } ?? doc.id, versionID: doc.string("versionId"),
    installed: doc.data["installedFrom"] != nil || doc.data["provenance"] != nil)
}

struct TemplatesSection: View {
  let context: NativePluginContext
  let actions: EmailActions
  @State private var list = LiveQueryList(pageSize: 25, map: templateRow)
  @State private var role = EmailRoleModel()
  @State private var searchText = ""
  @State private var search = ""
  @State private var creating = false
  @State private var duplicating: TemplateRow?
  @State private var deleting: TemplateRow?
  @State private var notice: (String, AglynTone)?

  var body: some View {
    VStack(spacing: 0) {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil }.padding(.horizontal, AglynSpace.two) }
      AglynLiveList(
        rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load templates",
        emptyTitle: search.isEmpty ? "No email designs yet" : "No templates match",
        emptyMessage: "Design an email once in the Besigner and send it from any campaign.", systemImage: "paintbrush",
        onMore: { list.loadMore() }, onRetry: { list.retry() }
      ) { row in
        Button {
          open(row)
        } label: {
          AglynRow(row.name, subtitle: row.installed ? "Installed" : "Yours", systemImage: "envelope.open") {
            Image(systemName: "paintbrush.pointed").foregroundStyle(.secondary)
          }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("template-\(row.id)")
        .contextMenu {
          Button("Open in the Besigner", systemImage: "paintbrush") { open(row) }
          if role.canEdit {
            Button("Duplicate", systemImage: "plus.square.on.square") { duplicating = row }
            Button("Delete", systemImage: "trash", role: .destructive) { deleting = row }
          }
        }
        .swipeActions {
          if role.canEdit { Button("Delete", role: .destructive) { deleting = row } }
        }
      }
    }
    .searchable(text: $searchText, prompt: "Search templates")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if role.canEdit {
        ToolbarItem(placement: .primaryAction) {
          Button("New design", systemImage: "plus") { creating = true }.accessibilityIdentifier("template-new")
        }
      }
    }
    .task(id: search) {
      role.start(context)
      let search = search, hostID = actions.hostID
      list.show(context.firestore) { templatesQuery(hostID, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $creating) {
      NameSheet(title: "New email design", label: "Name", initial: "Untitled email", confirm: "Create") { name in
        let ids = try await actions.createDesign(name)
        context.openBesigner("/screens/\(ids.screenID)/versions/\(ids.versionID)/besigner")
      }
    }
    .sheet(item: $duplicating) { row in
      NameSheet(title: "Duplicate \(row.name)", label: "Name", initial: "\(row.name) (copy)", confirm: "Duplicate") { name in
        try await actions.duplicateDesign(row.id, name: name)
        notice = ("Duplicated as \(name).", .success)
      }
    }
    .confirmationDialog("Delete this template?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
      Button("Delete", role: .destructive) {
        guard let row = deleting else { return }
        Task {
          do { try await actions.deleteDesign(row.id) } catch { notice = (problemText(error), .error) }
        }
      }
    } message: {
      Text("Emails already sent with it keep what they sent. Campaigns that name it can no longer send it.")
    }
  }

  private func open(_ row: TemplateRow) {
    guard let version = row.versionID else {
      notice = ("This design has no version to open yet.", .warning)
      return
    }
    context.openBesigner("/screens/\(row.id)/versions/\(version)/besigner")
  }
}

/// One name, asked for in a sheet (new, rename, duplicate).
struct NameSheet: View {
  let title: String
  let label: String
  let initial: String
  let confirm: String
  let save: (String) async throws -> Void
  @State private var name = ""

  var body: some View {
    AglynFormSheet(title, confirm: confirm, canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: {
      try await save(name.trimmingCharacters(in: .whitespaces))
    }) {
      TextField(label, text: $name).accessibilityIdentifier("name-sheet-field")
    }
    .onAppear { if name.isEmpty { name = initial } }
  }
}

// MARK: Audiences

struct EmailListRow: Identifiable, Hashable {
  let id: String
  let name: String
  let dynamic: Bool
}

func emailListRow(_ doc: FirestoreDocument) -> EmailListRow {
  EmailListRow(id: doc.id, name: doc.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? doc.id, dynamic: doc.string("kind") == "dynamic")
}

struct AudiencesSection: View {
  let context: NativePluginContext
  let actions: EmailActions
  var initial: String?
  @State private var list = LiveQueryList(pageSize: 25, map: emailListRow)
  @State private var kind = ""
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var creating = false

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          pane(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          if let selection {
            ListDetail(context: context, actions: actions, listID: selection).id(selection)
          } else {
            AglynEmptyState("Pick a list to see who is on it", systemImage: "person.3").frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      } else {
        pane(selectable: false)
      }
    }
    .searchable(text: $searchText, prompt: "Search lists")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("New list", systemImage: "plus") { creating = true }.accessibilityIdentifier("list-new")
      }
    }
    .task(id: "\(kind)|\(search)") {
      if selection == nil { selection = initial }
      let kind = kind, search = search, orgID = actions.orgID
      list.show(context.firestore) { listsQuery(orgID, kind: kind, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $creating) {
      NameSheet(title: "New list", label: "Name", initial: "", confirm: "Create") { try await actions.createList($0) }
    }
  }

  @ViewBuilder
  private func pane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      HStack(spacing: AglynSpace.one) {
        AglynChoiceChip("All", selected: kind.isEmpty) { kind = "" }
        AglynChoiceChip("Manual", selected: kind == "manual") { kind = "manual" }
        AglynChoiceChip("Rule", selected: kind == "dynamic") { kind = "dynamic" }
        Spacer()
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
      if selectable {
        if list.ready && list.failure == nil && !list.rows.isEmpty {
          List(selection: $selection) {
            ForEach(list.rows) { row in ListRowView(row: row).tag(row.id).aglynListRow() }
            if list.hasMore { Button("Show more") { list.loadMore() }.frame(maxWidth: .infinity) }
          }
          .aglynListBackground()
        } else {
          states
        }
      } else {
        AglynLiveList(
          rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load lists",
          emptyTitle: "No lists yet", emptyMessage: "A list is who an email goes to: people you add, or everyone a rule matches.",
          systemImage: "person.3", onMore: { list.loadMore() }, onRetry: { list.retry() }
        ) { row in
          NavigationLink { ListDetail(context: context, actions: actions, listID: row.id) } label: { ListRowView(row: row) }
        }
      }
    }
  }

  @ViewBuilder
  private var states: some View {
    AglynLiveList(
      rows: list.rows, ready: list.ready, failure: list.failure, hasMore: false, failedTitle: "Could not load lists",
      emptyTitle: "No lists yet", emptyMessage: "A list is who an email goes to: people you add, or everyone a rule matches.",
      systemImage: "person.3", onMore: {}, onRetry: { list.retry() }
    ) { row in ListRowView(row: row) }
  }
}

struct ListRowView: View {
  let row: EmailListRow
  var body: some View {
    AglynRow(row.name, subtitle: row.dynamic ? "Rule" : "Manual", systemImage: row.dynamic ? "wand.and.stars" : "person.3")
      .accessibilityIdentifier("list-\(row.id)")
  }
}

struct ListMemberRow: Identifiable {
  let id: String
  let email: String
  let name: String?
  let via: String?
  let joinedAt: Date?
}

func listMemberRow(_ doc: FirestoreDocument) -> ListMemberRow {
  ListMemberRow(
    id: doc.id, email: doc.string("email") ?? doc.id, name: doc.string("name"), via: doc.string("via"),
    joinedAt: epochMillis(doc.data["createdAt"] ?? doc.data["addedAt"]).map { Date(timeIntervalSince1970: Double($0) / 1000) })
}

/// One list: its members (search, remove), Add people, rename and delete.
struct ListDetail: View {
  let context: NativePluginContext
  let actions: EmailActions
  let listID: String
  @Environment(\.dismiss) private var dismiss
  @State private var doc = LiveDocument()
  @State private var members = LiveQueryList(pageSize: 25, map: listMemberRow)
  @State private var searchText = ""
  @State private var search = ""
  @State private var adding = false
  @State private var renaming = false
  @State private var confirmDelete = false
  @State private var removing: ListMemberRow?
  @State private var notice: (String, AglynTone)?

  var body: some View {
    let row = doc.document.map(emailListRow)
    VStack(spacing: 0) {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil }.padding(.horizontal, AglynSpace.two) }
      if let row, row.dynamic {
        AglynNotice("Everyone the list's rule matches is on it. The rule is edited on the website for now; its members are listed here.", tone: .info)
          .padding(.horizontal, AglynSpace.two)
      }
      TextField("Search members", text: $searchText)
        .textFieldStyle(.roundedBorder)
        .onSubmit { search = searchText }
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
      AglynLiveList(
        rows: members.rows, ready: members.ready, failure: members.failure, hasMore: members.hasMore,
        failedTitle: "Could not load members", emptyTitle: search.isEmpty ? "Nobody on this list yet" : "No members match",
        emptyMessage: "Add people by address; each is checked against consent and suppressions first.", systemImage: "person",
        onMore: { members.loadMore() }, onRetry: { members.retry() }
      ) { member in
        AglynRow(
          member.name.flatMap { $0.isEmpty ? nil : $0 } ?? member.email,
          subtitle: [member.name == nil ? nil : member.email, member.via == "rule" ? "Rule" : "Added", member.joinedAt.map { relativeTime($0) }]
            .compactMap { $0 }.joined(separator: " · "),
          systemImage: "person")
          .swipeActions { Button("Remove", role: .destructive) { removing = member } }
          .contextMenu { Button("Remove from this list", systemImage: "person.badge.minus", role: .destructive) { removing = member } }
      }
    }
    .navigationTitle(row?.name ?? "List")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Menu {
          Button("Add people", systemImage: "person.badge.plus") { adding = true }
          Button("Rename", systemImage: "pencil") { renaming = true }
          Button("Delete list", systemImage: "trash", role: .destructive) { confirmDelete = true }
        } label: {
          Label("List", systemImage: "ellipsis.circle")
        }
        .accessibilityIdentifier("list-actions")
      }
    }
    .task(id: "\(listID)|\(search)") {
      doc.start(context.firestore, ["orgs", actions.orgID, "lists", listID])
      let search = search, orgID = actions.orgID, listID = listID
      members.show(context.firestore) { listMembersQuery(orgID, listID: listID, search: search, limit: $0) }
    }
    .onDisappear {
      doc.stop()
      members.stop()
    }
    .sheet(isPresented: $adding) {
      AddPeopleSheet(actions: actions, listID: listID) { notice = ("Added \($0) to the list.", .success) }
    }
    .sheet(isPresented: $renaming) {
      NameSheet(title: "Rename list", label: "Name", initial: row?.name ?? "", confirm: "Save") { try await actions.renameList(listID, $0) }
    }
    .confirmationDialog("Delete list?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) {
        Task {
          do {
            try await actions.deleteList(listID)
            dismiss()
          } catch {
            notice = (problemText(error), .error)
          }
        }
      }
    } message: {
      Text("The list and its memberships go. The people stay in your contacts, and emails already sent keep their reports.")
    }
    .confirmationDialog("Remove from this list?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
      Button("Remove", role: .destructive) {
        guard let member = removing else { return }
        Task {
          do { try await actions.removeMember(listID: listID, memberID: member.id) } catch { notice = (problemText(error), .error) }
        }
      }
    } message: {
      Text("\(removing?.email ?? "They") will no longer get emails sent to this list.")
    }
  }
}

/// Add people by address: checked first (the route's preview), then added with one attestation.
struct AddPeopleSheet: View {
  let actions: EmailActions
  let listID: String
  let onAdded: (Int) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var preview: MemberPreview?
  @State private var attest = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        Section {
          TextField("Addresses", text: $text, axis: .vertical)
            .lineLimit(3...10)
            .onChange(of: text) { _, _ in preview = nil }
            .accessibilityIdentifier("add-people-addresses")
        } footer: {
          Text("One per line, or separated by commas.")
        }
        if let preview {
          Section("Before they are added") {
            LabeledContent("Opted in already", value: "\(preview.optedIn)")
            LabeledContent("Need your word they agreed", value: "\(preview.needAttestation)")
            LabeledContent("Cannot be added", value: "\(preview.refused)")
            ForEach(preview.verdicts.filter { $0.message != nil }) { verdict in
              LabeledContent(verdict.input, value: verdict.message ?? "")
            }
            if preview.needAttestation > 0 {
              Toggle("These people agreed to hear from us", isOn: $attest)
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Add people")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          if preview == nil {
            Button("Check") { Task { await check() } }.disabled(busy || addressesIn(text).isEmpty)
          } else {
            Button("Add") { Task { await add() } }
              .disabled(busy || (preview!.optedIn + (attest ? preview!.needAttestation : 0)) == 0)
              .accessibilityIdentifier("add-people-confirm")
          }
        }
      }
    }
    .frame(minWidth: 380, minHeight: 420)
  }

  private func check() async {
    busy = true
    error = nil
    defer { busy = false }
    do { preview = try await actions.previewMembers(listID: listID, emails: addressesIn(text)) } catch { self.error = problemText(error) }
  }

  private func add() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      let added = try await actions.addMembers(listID: listID, emails: addressesIn(text), attest: attest)
      onAdded(added)
      dismiss()
    } catch {
      self.error = problemText(error)
    }
  }
}

// MARK: Topics

struct TopicRow: Identifiable {
  let id: String
  let name: String
  let description: String?
  let archived: Bool
}

struct TopicsSection: View {
  let context: NativePluginContext
  let actions: EmailActions
  @State private var list = LiveQueryList(pageSize: 100) {
    TopicRow(id: $0.id, name: $0.string("name") ?? $0.id, description: $0.string("description"), archived: $0.bool("archived") == true)
  }
  @State private var adding = false
  @State private var name = ""
  @State private var detail = ""
  @State private var error: String?

  var body: some View {
    let rows = list.rows.sorted { ($0.archived ? 1 : 0, $0.name.lowercased()) < ($1.archived ? 1 : 0, $1.name.lowercased()) }
    VStack(spacing: 0) {
      if let error { AglynNotice(error, tone: .error) { self.error = nil }.padding(.horizontal, AglynSpace.two) }
      AglynLiveList(
        rows: rows, ready: list.ready, failure: list.failure, hasMore: false, failedTitle: "Could not load topics",
        emptyTitle: "No topics yet",
        emptyMessage: "A topic is a stream people can leave on its own, like a newsletter or product news, without leaving everything.",
        systemImage: "tag", onMore: {}, onRetry: { list.retry() }
      ) { topic in
        AglynRow(topic.name, subtitle: [topic.description, topic.archived ? "Retired" : nil].compactMap { $0 }.joined(separator: " · "), systemImage: "tag") {
          Button(topic.archived ? "Restore" : "Retire") {
            Task {
              do { try await actions.setTopicArchived(topic.id, !topic.archived) } catch { self.error = problemText(error) }
            }
          }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("topic-archive-\(topic.id)")
        }
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button("Add topic", systemImage: "plus") { adding = true } }
    }
    .task {
      let orgID = actions.orgID
      list.show(context.firestore) { _ in FirestoreQuery(["orgs", orgID, "emailTopics"], limit: 100) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $adding) {
      AglynFormSheet("Add topic", confirm: "Add", canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: {
        try await actions.addTopic(name: name.trimmingCharacters(in: .whitespaces), description: detail.trimmingCharacters(in: .whitespaces))
        name = ""
        detail = ""
      }) {
        TextField("Name", text: $name)
        TextField("What it is about", text: $detail, axis: .vertical)
      }
    }
  }
}

// MARK: Suppressions

struct SuppressionRow: Identifiable {
  let id: String
  let email: String
  let reason: String?
  let since: Date?
}

struct SuppressionsSection: View {
  let context: NativePluginContext
  let actions: EmailActions
  @State private var list = LiveQueryList(pageSize: 25) {
    SuppressionRow(
      id: $0.id, email: $0.string("email") ?? $0.id, reason: $0.string("reason"),
      since: epochMillis($0.data["createdAt"]).map { Date(timeIntervalSince1970: Double($0) / 1000) })
  }
  @State private var searchText = ""
  @State private var search = ""
  @State private var adding = false
  @State private var addresses = ""
  @State private var note = ""
  @State private var removing: SuppressionRow?
  @State private var notice: (String, AglynTone)?

  var body: some View {
    VStack(spacing: 0) {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil }.padding(.horizontal, AglynSpace.two) }
      AglynLiveList(
        rows: list.rows, ready: list.ready, failure: list.failure, hasMore: list.hasMore, failedTitle: "Could not load suppressions",
        emptyTitle: search.isEmpty ? "Nobody is suppressed" : "No address matches",
        emptyMessage: "Addresses that bounced, complained or unsubscribed are skipped by every send, and listed here.",
        systemImage: "nosign", onMore: { list.loadMore() }, onRetry: { list.retry() }
      ) { row in
        AglynRow(row.email, subtitle: [row.reason?.capitalized, row.since.map { relativeTime($0) }].compactMap { $0 }.joined(separator: " · "), systemImage: "nosign")
          .swipeActions { Button("Put back", role: .destructive) { removing = row } }
          .contextMenu { Button("Put back on your list", systemImage: "arrow.uturn.backward") { removing = row } }
      }
    }
    .searchable(text: $searchText, prompt: "Search addresses")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      ToolbarItem(placement: .primaryAction) { Button("Suppress", systemImage: "plus") { adding = true }.accessibilityIdentifier("suppression-add") }
    }
    .task(id: search) {
      let search = search, hostID = actions.hostID
      list.show(context.firestore) { suppressionsQuery(hostID, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
    .sheet(isPresented: $adding) {
      AglynFormSheet("Suppress addresses", confirm: "Suppress", canConfirm: !addressesIn(addresses).isEmpty, save: {
        _ = try await actions.addSuppressions(addressesIn(addresses), note: note.trimmingCharacters(in: .whitespaces))
        notice = ("Suppressed. No email from this site will go to them.", .success)
        addresses = ""
        note = ""
      }) {
        Section {
          TextField("Addresses", text: $addresses, axis: .vertical).lineLimit(3...8)
          TextField("Note (why)", text: $note)
        } footer: {
          Text("Every send from this site skips a suppressed address.")
        }
      }
    }
    .confirmationDialog("Put this address back on your list?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
      Button("Put back") {
        guard let row = removing else { return }
        Task {
          do { try await actions.removeSuppression(row.id) } catch { notice = (problemText(error), .error) }
        }
      }
    } message: {
      Text("\(removing?.email ?? "It") can be sent to again. Only do this if they asked to hear from you again.")
    }
  }
}

// MARK: Sending

struct SenderRow: Identifiable {
  let id: String
  let localPart: String
  let fromName: String?
  let replyTo: String?
  let isDefault: Bool
  let from: String?
}

struct DomainRow: Identifiable {
  var id: String { domain }
  let domain: String
  let status: String
}

struct SendingView {
  var selected = ""
  var platformDomain = ""
  var identity: String?
  var refusal: String?
  var senders: [SenderRow] = []
  var domains: [DomainRow] = []
  var dedicatedPlan = false

  init() {}

  init(_ answer: JSONValue?) {
    selected = answer?["selected"]?.stringValue ?? ""
    platformDomain = answer?["platformDomain"]?.stringValue ?? ""
    identity = answer?["identity"]?.stringValue
    refusal = answer?["refusal"]?.stringValue
    dedicatedPlan = answer?["dedicatedDomainPlan"]?.boolValue == true
    senders = (answer?["senders"]?.arrayValue ?? []).compactMap { item in
      guard let id = item["id"]?.stringValue else { return nil }
      return SenderRow(
        id: id, localPart: item["localPart"]?.stringValue ?? "", fromName: item["fromName"]?.stringValue,
        replyTo: item["replyTo"]?.stringValue, isDefault: item["isDefault"]?.boolValue == true, from: item["from"]?.stringValue)
    }
    domains = (answer?["domains"]?.arrayValue ?? []).compactMap { item in
      guard let domain = item["domain"]?.stringValue else { return nil }
      return DomainRow(domain: domain, status: item["status"]?.stringValue ?? "pending")
    }
  }
}

struct SendingSection: View {
  let context: NativePluginContext
  let actions: EmailActions
  @State private var view: SendingView?
  @State private var loadError: String?
  @State private var editing: SenderRow?
  @State private var creating = false
  @State private var notice: (String, AglynTone)?

  var body: some View {
    Form {
      if let notice { AglynNotice(notice.0, tone: notice.1) { self.notice = nil } }
      if let view {
        Section("Sending as") {
          PropertyRow("Address", view.identity ?? view.selected)
          if let refusal = view.refusal { Text(refusal).foregroundStyle(AglynColor.error) }
        }
        Section {
          ForEach(view.senders) { sender in
            AglynRow(
              sender.fromName ?? sender.localPart, subtitle: [sender.from ?? "\(sender.localPart)@…", sender.isDefault ? "Default" : nil].compactMap { $0 }.joined(separator: " · "),
              systemImage: sender.isDefault ? "star.fill" : "person.crop.circle"
            ) {
              Menu {
                Button("Edit", systemImage: "pencil") { editing = sender }
                if !sender.isDefault {
                  Button("Make default", systemImage: "star") { act(["action": "makeDefaultSender", "senderId": sender.id], "Default sender changed.") }
                  Button("Delete", systemImage: "trash", role: .destructive) { act(["action": "deleteSender", "senderId": sender.id], "Sender deleted.") }
                }
              } label: {
                Image(systemName: "ellipsis.circle")
              }
              .accessibilityIdentifier("sender-actions-\(sender.id)")
            }
          }
          Button("Add sender", systemImage: "plus") { creating = true }
        } header: {
          Text("Senders")
        } footer: {
          Text("Who an email comes from. A sender's mailbox is on the site's sending domain.")
        }
        Section {
          ForEach(view.domains) { domain in
            AglynRow(domain.domain, subtitle: domain.status.capitalized, systemImage: domain.status == "verified" ? "checkmark.seal" : "hourglass") {
              Menu {
                if domain.status == "verified" && view.selected != domain.domain {
                  Button("Send from this domain") { act(["domain": domain.domain], "This site now sends from \(domain.domain).") }
                }
                if domain.status != "verified" {
                  Button("Check again") { Task { await domainAct(domain.domain, "verify") } }
                }
              } label: {
                Image(systemName: "ellipsis.circle")
              }
            }
          }
          if view.domains.isEmpty { Text("No domains of your own yet. Add one on the website's Sending page.").foregroundStyle(.secondary) }
        } header: {
          Text("Domains")
        }
        if view.dedicatedPlan && view.platformDomain.isEmpty {
          Section {
            Button("Ask for a sending domain of this site's own") { act(["action": "request-dedicated"], "Asked for. It is set up within a few minutes.") }
          }
        }
      } else if let loadError {
        AglynNotice(loadError, tone: .error)
        Button("Try again") { Task { await load() } }
      } else {
        SkeletonRows(count: 5)
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .task { await load() }
    .refreshable { await load() }
    .sheet(item: $editing) { sender in SenderSheet(actions: actions, sender: sender) { Task { await load() } } }
    .sheet(isPresented: $creating) { SenderSheet(actions: actions, sender: nil) { Task { await load() } } }
  }

  private func load() async {
    do {
      view = SendingView(try await actions.identity())
      loadError = nil
    } catch {
      loadError = problemText(error)
    }
  }

  private func act(_ fields: [String: Any?], _ done: String) {
    Task {
      do {
        try await actions.identityAction(fields)
        notice = (done, .success)
        await load()
      } catch {
        notice = (problemText(error), .error)
      }
    }
  }

  private func domainAct(_ domain: String, _ action: String) async {
    do {
      try await actions.domainAction(domain, action: action)
      await load()
    } catch {
      notice = (problemText(error), .error)
    }
  }
}

struct SenderSheet: View {
  let actions: EmailActions
  let sender: SenderRow?
  let onSaved: () -> Void
  @State private var localPart = ""
  @State private var fromName = ""
  @State private var replyTo = ""

  var body: some View {
    AglynFormSheet(sender == nil ? "Add sender" : "Edit sender", canConfirm: !localPart.trimmingCharacters(in: .whitespaces).isEmpty, save: {
      var fields: [String: Any?] = [
        "action": sender == nil ? "createSender" : "updateSender", "localPart": localPart.trimmingCharacters(in: .whitespaces),
        "fromName": fromName.trimmingCharacters(in: .whitespaces), "replyTo": replyTo.trimmingCharacters(in: .whitespaces),
      ]
      if let sender { fields["senderId"] = sender.id }
      try await actions.identityAction(fields)
      onSaved()
    }) {
      TextField("Mailbox (before the @)", text: $localPart)
      TextField("From name", text: $fromName)
      TextField("Reply to", text: $replyTo)
    }
    .onAppear {
      guard let sender, localPart.isEmpty else { return }
      localPart = sender.localPart
      fromName = sender.fromName ?? ""
      replyTo = sender.replyTo ?? ""
    }
  }
}
