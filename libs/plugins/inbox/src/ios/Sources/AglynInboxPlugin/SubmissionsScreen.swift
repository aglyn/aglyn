// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A site's form submissions, or one form's (`formID`), the opened one
/// beside the list on wide windows (the Kotlin `SubmissionsScreen`): the read
/// filter, search, export, and each submission's fields with read or unread,
/// reply and delete.
struct SubmissionsScreen: View {
  let context: NativePluginContext
  let formID: String?
  let formName: String?
  var initialSubmissionID: String?

  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  @State private var model: SubmissionsModel
  @State private var role = SiteRoleModel()
  @State private var runner = PluginActionRunner()
  @State private var selection: String?
  @State private var pushed: String?
  @State private var searchText = ""
  @State private var exporting: TransferExportRequest?
  @State private var deleting: Submission?
  @State private var replying: Submission?
  @State private var site = ObservedDocument()
  @State private var forms = LiveQueryList(pageSize: 50) { (id: $0.id, name: inboxFormName($0)) }

  /// `initialRead`: the Read filter it opens on (`read=false` from Home's line: Unread).
  init(context: NativePluginContext, formID: String?, formName: String?, initialSubmissionID: String?, initialRead: String? = nil) {
    self.context = context
    self.formID = formID
    self.formName = formName
    self.initialSubmissionID = initialSubmissionID
    let model = SubmissionsModel(formID: formID)
    model.read = initialRead == "false" || initialRead == "true" ? initialRead : nil
    _model = State(initialValue: model)
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  private var api: SubmissionsAPI? {
    context.hostID.map {
      SubmissionsAPI(api: context.api, writer: context.writer, firestore: context.firestore, hostID: $0)
    }
  }

  /// The workspace's Inbox (no site picked): every site's submissions, the console's organization Inbox.
  private var wholeWorkspace: Bool { context.hostID == nil }

  /// The API for one submission: the site's, or on the workspace's Inbox the site it came in on.
  private func api(for submission: Submission) -> SubmissionsAPI? {
    guard let hostID = context.hostID ?? submission.hostID else { return nil }
    return SubmissionsAPI(api: context.api, writer: context.writer, firestore: context.firestore, hostID: hostID)
  }

  /// Whether the person may change a submission: on its own site, by their role there.
  private func canEdit(_ submission: Submission) -> Bool {
    if !wholeWorkspace { return role.canEditContent }
    let siteRole = submission.hostID.flatMap { id in context.sites.first { $0.id == id }?.role }
    return ["admin", "editor", "author"].contains(siteRole ?? "") || ["owner", "admin", "editor"].contains(context.orgRole ?? "")
  }

  private var siteName: String? { site.document?.string("displayName") ?? site.document?.string("name") }

  private var title: String { formName.map { "Submissions · \($0)" } ?? "Submissions" }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        AglynListDetailColumns(listWidth: 380) {
          list(selectable: true)
        } detail: {
          if let selection {
            detail(selection, titled: false).id(selection)
          } else {
            AglynSelectionPlaceholder("No submission selected", systemImage: InboxSymbols.inbox)
          }
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle(title)
    .aglynScreenTitle(title)
    // On the Mac and iPad the read state, the site and the form are the list toolbar's one Filter (Calm rule 3; Zach
    // 10/20: no chip row over the list); a phone keeps them as chips over its list.
    .aglynSearchable(text: $searchText, prompt: "Search submissions") { filterMenu }
    .onChange(of: searchText) { _, text in model.type(text) }
    .aglynScreenToolbar(id: "submissions") {
      if !wholeWorkspace {
        Button {
          runner.clear()
          exporting = TransferExportRequest(
            resource: "forms.submissions", title: formName.map { "Export \($0) submissions" } ?? "Export submissions",
            hostID: context.hostID,
            scope: submissionsExportScope(formID: formID ?? model.pickedForm, read: model.read),
            fileStem: "submissions", filter: (formID ?? model.pickedForm).map { ["formId": .string($0)] })
        } label: {
          Label("Export", systemImage: "square.and.arrow.down")
        }
        .keyboardShortcut("e", modifiers: [.command, .shift])
        .accessibilityIdentifier("submissions-export")
      }
    }
    .aglynPushDestination(item: $pushed) { id in detail(id, titled: true) }
    .safeAreaInset(edge: .bottom) {
      if exporting == nil, replying == nil, let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }
          .padding(AglynSpace.two)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.snappy, value: runner.notice)
    .sensoryFeedback(.success, trigger: runner.notice) { _, notice in notice != nil }
    .sheet(item: $exporting) { request in
      TransferExportSheet(context: context, request: request) { message in
        exporting = nil
        if let message { runner.notice = message }
      }
    }
    .sheet(item: $replying) { submission in
      if let api = api(for: submission) {
        ReplySheet(
          submission: submission, siteName: siteName ?? context.siteName(submission.hostID), api: api, runner: runner
        ) { replying = nil }
      }
    }
    .confirmationDialog(
      "Delete this submission?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible, presenting: deleting
    ) { submission in
      Button("Delete", role: .destructive) { delete(submission) }
    } message: { _ in
      Text("It is removed for everyone. The form's counts are refreshed.")
    }
    .task(id: context.hostID ?? context.orgID) {
      role.start(context)
      model.start(context.firestore, hostID: context.hostID, orgID: context.orgID)
      if let hostID = context.hostID {
        site.start(context.firestore, ["hosts", hostID])
        if formID == nil { forms.show(context.firestore) { _ in formsQuery(hostID) } }
      }
      if let initialSubmissionID {
        selection = initialSubmissionID
        if !isWide { pushed = initialSubmissionID }
      }
    }
    .onDisappear {
      model.stop()
      role.stop()
      site.stop()
      forms.stop()
    }
  }

  // MARK: The list

  /// What the Filter says once something is picked: the picks' names, joined.
  private var activeFilter: String? {
    let parts = [
      readChoices().first { $0.value == model.read && $0.value != nil }?.label,
      model.pickedSite.flatMap { id in context.sites.first { $0.id == id }?.name },
      model.pickedForm.flatMap { id in forms.rows.first { $0.id == id }?.name },
    ].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// The list toolbar's one Filter: Show (All, Unread, Read), then Site and Form where there is a choice.
  private var filterMenu: some View {
    AglynFilterMenu(active: activeFilter) {
      Picker("Show", selection: Binding(get: { model.read ?? "" }, set: { model.read = $0.isEmpty ? nil : $0 })) {
        ForEach(readChoices(), id: \.label) { choice in Text(choice.label).tag(choice.value ?? "") }
      }
      .pickerStyle(.inline)
      if wholeWorkspace && context.sites.count > 1 {
        Picker("Site", selection: Binding(get: { model.pickedSite ?? "" }, set: { model.pickedSite = $0.isEmpty ? nil : $0 })) {
          Text("Every site").tag("")
          ForEach(context.sites) { site in Text(site.name).tag(site.id) }
        }
        .accessibilityIdentifier("inbox-site-pick")
      }
      if formID == nil && forms.rows.count > 1 {
        Picker("Form", selection: Binding(get: { model.pickedForm ?? "" }, set: { model.pickedForm = $0.isEmpty ? nil : $0 })) {
          Text("Every form").tag("")
          ForEach(forms.rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }, id: \.id) { form in
            Text(form.name).tag(form.id)
          }
        }
        .accessibilityIdentifier("inbox-form-pick")
      }
    }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(readChoices(), id: \.label) { choice in
          AglynChoiceChip(choice.label, selected: model.read == choice.value) { model.read = choice.value }
            .accessibilityIdentifier("submissions-read-\(choice.value ?? "all")")
        }
        if wholeWorkspace && context.sites.count > 1 {
          Divider().frame(height: 24)
          Menu {
            Button("Every site") { model.pickedSite = nil }
            ForEach(context.sites) { site in Button(site.name) { model.pickedSite = site.id } }
          } label: {
            Label(context.sites.first { $0.id == model.pickedSite }?.name ?? "Every site", systemImage: "globe")
          }
          .accessibilityIdentifier("inbox-site-pick")
        }
        if formID == nil && forms.rows.count > 1 {
          Divider().frame(height: 24)
          Menu {
            Button("Every form") { model.pickedForm = nil }
            ForEach(forms.rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }, id: \.id) { form in
              Button(form.name) { model.pickedForm = form.id }
            }
          } label: {
            Label(forms.rows.first { $0.id == model.pickedForm }?.name ?? "Every form", systemImage: "doc.text")
          }
          .accessibilityIdentifier("inbox-form-pick")
        }
      }
      .aglynContentEdges()
      .padding(.vertical, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      if !isWide { chips }
      if exporting == nil, replying == nil, deleting == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }.aglynContentEdges()
      }
      if let notice = model.notice {
        AglynNotice(notice, tone: .info).aglynContentEdges()
      }
      content(selectable: selectable)
    }
    .background(AglynGround())
  }

  private var filtered: Bool {
    !model.search.isEmpty || model.read != nil || model.pickedForm != nil || model.pickedSite != nil
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState(
        "Could not load submissions", systemImage: "exclamationmark.triangle",
        message: "Submissions could not be loaded. Check the connection and try again."
      ) {
        Button("Try again") { model.retry() }
      }
    } else if model.rows.isEmpty {
      AglynEmptyState(
        filtered ? "No submissions match" : "No submissions yet", systemImage: InboxSymbols.inbox,
        message: filtered
          ? "Try another filter or search."
          : wholeWorkspace
            ? "What visitors send through any site's forms shows up here."
            : "What visitors send through your forms shows up here.")
    } else if selectable {
      List { rows(selectable: true) }
        .onChange(of: model.rows, initial: true) { _, rows in
          if selection == nil { selection = rows.first?.id }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynSelectableListStyle().aglynSelectionKeys(model.rows.map(\.id), selection: $selection)
        .accessibilityIdentifier("submissions-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("submissions-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    let now = Date()
    ForEach(model.rows) { row in
      Group {
        if selectable {
          SubmissionListRow(row: row, showForm: formID == nil, site: siteLabel(row), now: now)
            .aglynSelectableRow(row.id, selection: $selection)
        } else {
          Button {
            pushed = row.id
          } label: {
            SubmissionListRow(row: row, showForm: formID == nil, site: siteLabel(row), now: now)
          }
          .buttonStyle(.aglynRow)
        }
      }
      .swipeActions(edge: .trailing) {
        Button(role: .destructive) { ask(delete: row) } label: { Label("Delete", systemImage: "trash") }
          .disabled(!canEdit(row))
      }
      .swipeActions(edge: .leading) {
        Button { toggleRead(row) } label: {
          Label(row.read ? "Unread" : "Read", systemImage: row.read ? InboxSymbols.unread : InboxSymbols.read)
        }
        .tint(AglynColor.primary)
        .disabled(!canEdit(row))
      }
      .contextMenu {
        Button { toggleRead(row) } label: {
          Label(row.read ? "Mark as unread" : "Mark as read", systemImage: row.read ? InboxSymbols.unread : InboxSymbols.read)
        }
        .disabled(!canEdit(row))
        if row.sender.email != nil {
          Button { replying = row } label: { Label("Reply", systemImage: InboxSymbols.reply) }
            .disabled(!canEdit(row))
        }
        Button(role: .destructive) { ask(delete: row) } label: { Label("Delete", systemImage: "trash") }
          .disabled(!canEdit(row))
      }
      .aglynListRow()
      .accessibilityIdentifier("submission-\(row.id)")
      .onAppear { if row.id == model.rows.last?.id { model.loadMore() } }
    }
    if model.hasMore {
      Button("Show more submissions") { model.loadMore() }
        .frame(maxWidth: .infinity)
        .aglynListRow()
        .accessibilityIdentifier("submissions-more")
    }
  }

  // MARK: Actions

  /// The site a row came in on, named on the workspace's Inbox.
  private func siteLabel(_ row: Submission) -> String? {
    wholeWorkspace ? row.hostID.map(context.siteName) : nil
  }

  /// One submission's detail, on its own site.
  @ViewBuilder
  private func detail(_ id: String, titled: Bool) -> some View {
    let host = context.hostID ?? model.rows.first { $0.id == id }?.hostID
    if let host {
      siteDetail(id, titled: titled, context: context.hostID == nil ? context.onSite(host) : context)
    } else {
      AglynSelectionPlaceholder("No submission selected", systemImage: InboxSymbols.inbox)
    }
  }

  @ViewBuilder
  private func siteDetail(_ id: String, titled: Bool, context: NativePluginContext) -> some View {
    if wholeWorkspace {
      // On the workspace's Inbox each submission is read under the person's role on its own site.
      SiteRoleScope(context: context) { siteRole in
        SubmissionDetailView(
          context: context, submissionID: id, runner: runner, role: siteRole,
          siteName: context.siteName(context.hostID), titled: titled,
          onRead: { model.patch($0, read: $1) }, toggleRead: toggleRead, reply: { replying = $0 }, delete: ask(delete:))
      }
    } else {
      SubmissionDetailView(
        context: context, submissionID: id, runner: runner, role: role, siteName: siteName, titled: titled,
        onRead: { model.patch($0, read: $1) }, toggleRead: toggleRead, reply: { replying = $0 }, delete: ask(delete:))
    }
  }

  private func ask(delete submission: Submission) {
    runner.clear()
    deleting = submission
  }

  private func toggleRead(_ submission: Submission) {
    guard let api = api(for: submission) else { return }
    let next = !submission.read
    runner.run {
      try await api.setRead(submission.id, read: next)
      model.patch(submission.id, read: next)
    }
  }

  private func delete(_ submission: Submission) {
    guard let api = api(for: submission) else { return }
    runner.run(success: "Submission deleted.") {
      try await api.delete(submission)
      model.patch(submission.id, removed: true)
      if selection == submission.id { selection = model.rows.first?.id }
      if pushed == submission.id { pushed = nil }
    }
  }
}

struct SubmissionListRow: View {
  let row: Submission
  var showForm = true
  /// The site it came in on, on the workspace's Inbox.
  var site: String? = nil
  var now = Date()

  var body: some View {
    HStack(alignment: .top, spacing: AglynSpace.one) {
      Circle()
        .fill(row.read ? Color.clear : AglynColor.primary)
        .frame(width: 8, height: 8)
        .padding(.top, 7)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        HStack(alignment: .firstTextBaseline) {
          Text(row.from).font(row.read ? AglynFont.body : AglynFont.body.weight(.semibold)).lineLimit(1)
          Spacer(minLength: AglynSpace.one)
          if let createdAt = row.createdAt {
            Text(relativeTime(createdAt, now: now)).font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        let subtitle = [site, showForm ? row.formName : nil, row.preview.isEmpty ? nil : row.preview]
          .compactMap { $0 }.joined(separator: " — ")
        if !subtitle.isEmpty {
          Text(subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
      }
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityValue(row.read ? "Read" : "Unread")
  }
}

/// The person's role on one site, live, for a view on a workspace-wide list that acts on that site.
struct SiteRoleScope<Content: View>: View {
  let context: NativePluginContext
  @ViewBuilder let content: (SiteRoleModel) -> Content
  @State private var role = SiteRoleModel()

  var body: some View {
    content(role)
      .task(id: context.hostID) { role.start(context) }
      .onDisappear { role.stop() }
  }
}
