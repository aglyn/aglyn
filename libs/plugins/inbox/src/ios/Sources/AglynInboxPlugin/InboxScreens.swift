// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The site's own document: its name (the reply's default subject) and the member's role on it.
@MainActor
@Observable
final class InboxSiteModel {
  @ObservationIgnored let doc = LiveDocument()
  private var uid = ""

  func start(_ context: NativePluginContext) {
    uid = context.uid
    guard let hostID = context.hostID else { return }
    doc.start(context.firestore, ["hosts", hostID])
  }

  var name: String? { doc.document?.string("displayName") ?? doc.document?.string("name") }
  var role: String? { (doc.document?.data["memberRoles"] as? [String: Any])?[uid] as? String }
  var permissions: InboxPermissions { InboxPermissions(role: role) }
}

private func message(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
}

/// A site's form submissions: Unread / Read chips, a form pick and a search;
/// the picked message beside the list in a wide window.
struct SubmissionsScreen: View {
  let context: NativePluginContext
  var initialSubmission: String?
  /// A form's own submissions (the `formId` param): the form is the list's scope and the Form pick is not offered.
  var scopedForm: String?
  @State private var list = LiveQueryList(pageSize: submissionsPageSize, map: submission)
  @State private var forms = LiveQueryList(pageSize: 50) { (id: $0.id, name: formName($0)) }
  @State private var site = InboxSiteModel()
  @State private var read: ReadFilter = .all
  @State private var formID = ""
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          listPane(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              SubmissionDetail(context: context, submissionID: selection, site: site).id(selection)
            } else {
              AglynEmptyState("Pick a message to read it here", systemImage: "tray")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        listPane(selectable: false)
      }
    }
    .navigationTitle(scopedForm == nil ? "Inbox" : "Submissions")
    .searchable(text: $searchText, prompt: "Search messages")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .task(id: "\(read.rawValue)|\(formID)|\(search)|\(context.hostID ?? "")") { restart() }
    .task(id: context.hostID) {
      site.start(context)
      if let hostID = context.hostID, scopedForm == nil {
        forms.show(context.firestore) { _ in formsQuery(hostID) }
      }
      if selection == nil { selection = initialSubmission }
    }
    .onDisappear {
      list.stop()
      forms.stop()
    }
  }

  private func restart() {
    guard let hostID = context.hostID else { return }
    let read = read, formID = formID, search = search, scopedForm = scopedForm
    list.show(context.firestore) {
      submissionsQuery(hostID, read: read, formID: formID, search: search, limit: $0, scopedForm: scopedForm)
    }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(ReadFilter.allCases) { filter in
          AglynChoiceChip(filter.label, selected: read == filter) { read = filter }
        }
        if scopedForm == nil && forms.rows.count > 1 {
          Divider().frame(height: 24)
          Menu {
            Button("Every form") { formID = "" }
            ForEach(forms.rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }, id: \.id) { form in
              Button(form.name) { formID = form.id }
            }
          } label: {
            Label(forms.rows.first { $0.id == formID }?.name ?? "Every form", systemImage: "doc.text")
          }
          .accessibilityIdentifier("inbox-form-pick")
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func listPane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if !list.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if let failure = list.failure {
        AglynEmptyState("Could not load the Inbox", systemImage: "exclamationmark.triangle", message: failure) {
          Button("Try again") { list.retry() }
        }
      } else if list.rows.isEmpty {
        let filtered = read != .all || !formID.isEmpty || !search.isEmpty
        AglynEmptyState(
          filtered ? "No messages match" : "No messages yet", systemImage: "tray",
          message: filtered ? "Try another filter or search." : "What visitors send through your forms arrives here.")
      } else if selectable {
        List(selection: $selection) { rows(selectable: true) }
          .sensoryFeedback(.selection, trigger: selection)
          .aglynListBackground()
          .accessibilityIdentifier("submissions-list")
      } else {
        List { rows(selectable: false) }
          .refreshable { list.retry() }
          .aglynListBackground()
          .accessibilityIdentifier("submissions-list")
      }
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(list.rows) { row in
      Group {
        if selectable {
          SubmissionRow(row: row).tag(row.id)
        } else {
          NavigationLink {
            SubmissionDetail(context: context, submissionID: row.id, site: site)
          } label: {
            SubmissionRow(row: row)
          }
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("submission-\(row.id)")
    }
    if list.hasMore {
      Button("Show more messages") { list.loadMore() }.frame(maxWidth: .infinity)
    }
  }
}

/// One message on its own (`inbox.submission`), as a form's screen or a notification opens it.
struct SubmissionScreen: View {
  let context: NativePluginContext
  let submissionID: String?
  @State private var site = InboxSiteModel()

  var body: some View {
    if let submissionID, !submissionID.isEmpty {
      SubmissionDetail(context: context, submissionID: submissionID, site: site)
        .task(id: context.hostID) { site.start(context) }
    } else {
      SubmissionsScreen(context: context)
    }
  }
}

struct SubmissionRow: View {
  let row: Submission

  var body: some View {
    AglynRow(
      row.sender.label,
      subtitle: [row.formName, row.preview].filter { !$0.isEmpty }.joined(separator: " · "),
      systemImage: row.read ? "envelope.open" : "envelope.badge"
    ) {
      VStack(alignment: .trailing, spacing: 4) {
        if let receivedAt = row.receivedAt {
          Text(relativeTime(receivedAt)).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if !row.read {
          Circle().fill(AglynColor.primary).frame(width: 10, height: 10).accessibilityLabel("Unread")
        } else if row.repliedAt != nil {
          Image(systemName: "arrowshape.turn.up.left").font(AglynFont.caption).foregroundStyle(.secondary)
            .accessibilityLabel("Replied")
        }
      }
    }
    .fontWeight(row.read ? nil : .semibold)
  }
}

/// One message: who sent it, every field, what the site did with it, the reply and the list add. Opening it marks it read.
struct SubmissionDetail: View {
  let context: NativePluginContext
  let submissionID: String
  let site: InboxSiteModel
  @State private var doc = LiveDocument()
  @State private var replies = LiveQueryList(pageSize: 10, map: sentReply)
  @State private var notice: (String, AglynTone)?
  @State private var confirmDelete = false
  @State private var markedOnOpen = false
  @State private var subject = ""
  @State private var replyText = ""
  @State private var sending = false
  @State private var replyError: String?
  @State private var listSheet = false

  private var actions: InboxActions? {
    context.hostID.map { InboxActions(api: context.api, reader: context.firestore, hostID: $0) }
  }

  var body: some View {
    Group {
      if !doc.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if doc.failed {
        AglynEmptyState("Could not load this message", systemImage: "exclamationmark.triangle")
      } else if let document = doc.document {
        content(submission(document))
      } else {
        AglynEmptyState("That message is no longer in the Inbox", systemImage: "tray", message: "It may have been deleted.")
      }
    }
    .task(id: submissionID) {
      guard let hostID = context.hostID else { return }
      doc.start(context.firestore, submissionsPath(hostID) + [submissionID])
      replies.show(context.firestore) { _ in
        FirestoreQuery(repliesPath(hostID, submissionID), order: [.init("sentAtMs", descending: true)], limit: 10)
      }
    }
    .onDisappear {
      doc.stop()
      replies.stop()
    }
  }

  @ViewBuilder
  private func content(_ row: Submission) -> some View {
    let permissions = site.permissions
    Form {
      if let notice {
        AglynNotice(notice.0, tone: notice.1) { self.notice = nil }
      }
      Section {
        VStack(alignment: .leading, spacing: 4) {
          Text(row.sender.label).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          if let email = row.sender.email, email != row.sender.label { Text(email).textSelection(.enabled) }
          Text([row.formName, row.receivedAt.map { formatReceiptTime(Int64($0.timeIntervalSince1970 * 1000)) }].compactMap { $0 }.joined(separator: " · "))
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        if permissions.canWrite {
          Button {
            Task { await toggleRead(row) }
          } label: {
            Label(row.read ? "Mark unread" : "Mark read", systemImage: row.read ? "envelope.badge" : "envelope.open")
          }
          .accessibilityIdentifier("submission-toggle-read")
          Button(role: .destructive) {
            confirmDelete = true
          } label: {
            Label("Delete", systemImage: "trash")
          }
          .accessibilityIdentifier("submission-delete")
        }
      }
      Section("Message") {
        if row.fields.isEmpty { Text("This message has no fields.").foregroundStyle(.secondary) }
        ForEach(row.fields, id: \.key) { field in PropertyRow(field.key, field.value) }
        if let path = row.path, !path.isEmpty { PropertyRow("Sent from", path) }
        HStack(spacing: AglynSpace.one) {
          ForEach(row.chips, id: \.self) { chip in
            StatusChip(chip.label, tone: chip.color == .success ? .success : chip.color == .info ? .info : chip.color == .warning ? .warning : .neutral)
          }
        }
        if let kind = row.capturedKind, let id = row.capturedID {
          Button(kind == "lead" ? "Open the lead in the CRM" : "Open the contact in the CRM") {
            context.navigate(kind == "lead" ? "crm.lead" : "crm.contact", [kind: id])
          }
        }
      }
      if permissions.canReply {
        replySection(row)
        Section("Add to a marketing list") {
          Button {
            listSheet = true
          } label: {
            Label("Choose a list", systemImage: "list.bullet")
          }
          .accessibilityIdentifier("submission-add-to-list")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle(row.sender.label)
    .task(id: row.id) {
      if subject.isEmpty { subject = defaultReplySubject(siteName: site.name, formName: row.formName) }
      if !row.read && permissions.canWrite && !markedOnOpen {
        markedOnOpen = true
        try? await actions?.setRead(row.id, true)
      }
    }
    .confirmationDialog("Delete this message?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await delete(row) } }
    } message: {
      Text("It leaves the Inbox for everyone on the site. This cannot be undone.")
    }
    .sheet(isPresented: $listSheet) {
      if let actions {
        ListAssignmentSheet(row: row, actions: actions) { notice = ($0, .success) }
      }
    }
  }

  @ViewBuilder
  private func replySection(_ row: Submission) -> some View {
    Section {
      if let email = row.sender.email {
        Text("To \(email). Their answer comes to your own email.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        TextField("Subject", text: $subject)
          .onChange(of: subject) { _, text in
            if text.count > ContractValues.shared.replySubjectMax { subject = String(text.prefix(ContractValues.shared.replySubjectMax)) }
          }
          .accessibilityIdentifier("reply-subject")
        TextField("Message", text: $replyText, axis: .vertical)
          .lineLimit(4...12)
          .accessibilityIdentifier("reply-message")
        if let replyError { Text(replyError).foregroundStyle(AglynColor.error).font(AglynFont.caption) }
        Button {
          Task { await send(row) }
        } label: {
          Label(sending ? "Sending…" : "Send reply", systemImage: "paperplane")
        }
        .disabled(sending || subject.trimmingCharacters(in: .whitespaces).isEmpty || replyText.trimmingCharacters(in: .whitespaces).isEmpty)
        .accessibilityIdentifier("reply-send")
      } else {
        Text("This message has no email address to answer.").foregroundStyle(.secondary)
      }
      ForEach(replies.rows) { reply in
        AglynRow(
          reply.subject.isEmpty ? "Reply" : reply.subject,
          subtitle: [reply.to, reply.sentAt.map { relativeTime($0) }, String(reply.message.prefix(140))].compactMap { $0 }
            .filter { !$0.isEmpty }.joined(separator: " · "),
          systemImage: "arrowshape.turn.up.left")
      }
    } header: {
      Text("Reply")
    } footer: {
      Text("Your reply quotes their message below it.")
    }
  }

  private func toggleRead(_ row: Submission) async {
    do { try await actions?.setRead(row.id, !row.read) } catch { notice = (message(error), .error) }
  }

  private func delete(_ row: Submission) async {
    do { try await actions?.delete(row) } catch { notice = (message(error), .error) }
  }

  private func send(_ row: Submission) async {
    guard let actions else { return }
    sending = true
    replyError = nil
    defer { sending = false }
    do {
      let to = try await actions.reply(
        row.id, subject: subject.trimmingCharacters(in: .whitespaces), message: replyText.trimmingCharacters(in: .whitespacesAndNewlines))
      replyText = ""
      notice = ("Your reply is on its way to \(to ?? row.sender.email ?? "them").", .success)
    } catch {
      replyError = message(error)
    }
  }
}

/// Picks one of the workspace's email lists for the sender, as the console's list card does.
struct ListAssignmentSheet: View {
  let row: Submission
  let actions: InboxActions
  let onDone: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var options: ListOptions?
  @State private var loadError: String?
  @State private var listID = ""
  @State private var attest = false
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let options {
          if let summary = options.summary { Text(summary).foregroundStyle(.secondary) }
          if options.lists.isEmpty {
            Text("There are no lists yet. Make one under Email, Audiences.")
          } else if !options.enrollable {
            Text(options.summary ?? "This sender cannot be added to a list.")
          } else {
            Picker("List", selection: $listID) {
              Text("Choose").tag("")
              ForEach(options.lists) { Text($0.name).tag($0.id) }
            }
            if options.truncated { Text("Showing the first \(options.lists.count) lists.").font(AglynFont.caption) }
            if options.requiresAttestation {
              Toggle("They agreed to hear from us", isOn: $attest)
            }
          }
        } else if let loadError {
          Text(loadError).foregroundStyle(AglynColor.error)
        } else {
          SkeletonRows(count: 2)
        }
        if let error { Text(error).foregroundStyle(AglynColor.error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Add to a marketing list")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add") { Task { await add() } }
            .disabled(busy || listID.isEmpty || options?.enrollable != true || (options?.requiresAttestation == true && !attest))
        }
      }
      .task {
        do { options = try await actions.listOptions(row.id) } catch { loadError = message(error) }
      }
    }
    .frame(minWidth: 360, minHeight: 300)
  }

  private func add() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      let name = try await actions.assignList(row.id, listID: listID, attest: attest)
      onDone("Added to \(name ?? "the list").")
      dismiss()
    } catch {
      self.error = message(error)
    }
  }
}

/// The site's members and the leads it may see; a lead opens in the CRM.
struct PeopleScreen: View {
  let context: NativePluginContext
  @State private var tab = "members"
  @State private var members = LiveQueryList(pageSize: 25, map: siteMember)
  @State private var leads = LiveQueryList(pageSize: 25, map: leadRow)
  @State private var site = InboxSiteModel()
  @State private var searchText = ""
  @State private var search = ""
  @State private var removing: SiteMemberRow?
  @State private var error: String?

  var body: some View {
    VStack(spacing: 0) {
      Picker("Show", selection: $tab) {
        Text("Site members").tag("members")
        Text("Leads").tag("leads")
      }
      .pickerStyle(.segmented)
      .padding(AglynSpace.two)
      if let error { AglynNotice(error, tone: .error) { self.error = nil }.padding(.horizontal, AglynSpace.two) }
      if tab == "members" { membersList } else { leadsList }
    }
    .background(AglynColor.page)
    .navigationTitle("Members & leads")
    .searchable(text: $searchText, prompt: tab == "members" ? "Search members" : "Search leads")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .task(id: "\(tab)|\(search)|\(context.hostID ?? "")") {
      site.start(context)
      guard let hostID = context.hostID else { return }
      let search = search
      if tab == "members" {
        members.show(context.firestore) { siteMembersQuery(hostID, search: search, limit: $0) }
      } else if let orgID = context.orgID {
        leads.show(context.firestore) { siteLeadsQuery(orgID: orgID, hostID: hostID, search: search, limit: $0) }
      }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "this member")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        guard let member = removing, let hostID = context.hostID else { return }
        Task {
          do {
            try await InboxActions(api: context.api, reader: context.firestore, hostID: hostID).removeMember(member.id)
          } catch {
            self.error = message(error)
          }
        }
      }
    } message: {
      Text("They lose their account on this site. Their past orders and messages stay.")
    }
  }

  private var canRemove: Bool { ["owner", "admin"].contains(site.role ?? "") }

  @ViewBuilder
  private var membersList: some View {
    if !members.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure = members.failure {
      AglynEmptyState("Could not load members", systemImage: "exclamationmark.triangle", message: failure)
    } else if members.rows.isEmpty {
      AglynEmptyState("No members yet", systemImage: "person.2", message: "People who sign up on the site show up here.")
    } else {
      List {
        ForEach(members.rows) { member in
          AglynRow(
            member.name,
            subtitle: [member.email == member.name ? nil : member.email, member.joinedAt.map { "Joined \(relativeTime($0))" }]
              .compactMap { $0 }.joined(separator: " · "),
            systemImage: "person"
          ) {
            if canRemove {
              Button("Remove") { removing = member }.buttonStyle(.borderless)
                .accessibilityIdentifier("member-remove-\(member.id)")
            }
          }
          .aglynListRow()
        }
        if members.hasMore { Button("Show more") { members.loadMore() }.frame(maxWidth: .infinity) }
      }
      .refreshable { members.retry() }
      .aglynListBackground()
    }
  }

  @ViewBuilder
  private var leadsList: some View {
    if !leads.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if let failure = leads.failure {
      AglynEmptyState("Could not load leads", systemImage: "exclamationmark.triangle", message: failure)
    } else if leads.rows.isEmpty {
      AglynEmptyState("No leads yet", systemImage: "person.badge.plus", message: "People your forms capture as leads show up here.")
    } else {
      List {
        ForEach(leads.rows) { lead in
          Button {
            context.navigate("crm.lead", ["lead": lead.id])
          } label: {
            AglynRow(
              lead.name, subtitle: [lead.email == lead.name ? nil : lead.email, lead.company].compactMap { $0 }.joined(separator: " · "),
              systemImage: "person.badge.plus"
            ) {
              if let status = lead.statusLabel { StatusChip(status) }
            }
          }
          .buttonStyle(.plain)
          .aglynListRow()
          .accessibilityIdentifier("lead-\(lead.id)")
        }
        if leads.hasMore { Button("Show more") { leads.loadMore() }.frame(maxWidth: .infinity) }
      }
      .refreshable { leads.retry() }
      .aglynListBackground()
    }
  }
}

/// Home's Inbox card: unread among the newest messages, as the console's glance card counts them.
struct InboxGlanceWidget: View {
  let context: NativePluginContext
  @State private var list = LiveQueryList(pageSize: 3, map: submission)

  var body: some View {
    let unread = list.ready && list.failure == nil ? list.rows.filter { !$0.read }.count : nil
    MetricCard(
      "Inbox", systemImage: "tray", tone: .info, value: unread.map(String.init),
      caption: list.rows.isEmpty
        ? "No messages yet"
        : unread == 0 ? "All caught up" : list.hasMore ? "unread here, more in the Inbox" : unread == 1 ? "unread message" : "unread messages",
      actionLabel: "Open the Inbox", failed: list.failure.map { _ in "Could not load the Inbox." }
    ) {
      context.navigate(inboxScreen)
    }
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      list.show(context.firestore) { submissionsQuery(hostID, read: .all, formID: nil, search: "", limit: $0) }
    }
    .onDisappear { list.stop() }
  }
}
