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

  init(context: NativePluginContext, formID: String?, formName: String?, initialSubmissionID: String?) {
    self.context = context
    self.formID = formID
    self.formName = formName
    self.initialSubmissionID = initialSubmissionID
    _model = State(initialValue: SubmissionsModel(formID: formID))
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

  private var siteName: String? { site.document?.string("displayName") ?? site.document?.string("name") }

  private var title: String { formName.map { "Submissions · \($0)" } ?? "Submissions" }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              detail(selection, titled: false).id(selection)
            } else {
              AglynEmptyState("Pick a submission to read it", systemImage: InboxSymbols.inbox)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle(title)
    .searchable(text: $searchText, prompt: "Search submissions")
    .onChange(of: searchText) { _, text in model.type(text) }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
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
    .navigationDestination(item: $pushed) { id in detail(id, titled: true) }
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
      if let api { ReplySheet(submission: submission, siteName: siteName, api: api, runner: runner) { replying = nil } }
    }
    .confirmationDialog(
      "Delete this submission?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible, presenting: deleting
    ) { submission in
      Button("Delete", role: .destructive) { delete(submission) }
    } message: { _ in
      Text("It is removed for everyone. The form's counts are refreshed.")
    }
    .task(id: context.hostID) {
      role.start(context)
      model.start(context.firestore, hostID: context.hostID)
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

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(readChoices(), id: \.label) { choice in
          AglynChoiceChip(choice.label, selected: model.read == choice.value) { model.read = choice.value }
            .accessibilityIdentifier("submissions-read-\(choice.value ?? "all")")
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
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if exporting == nil, replying == nil, deleting == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }.padding(.horizontal, AglynSpace.two)
      }
      if let notice = model.notice {
        AglynNotice(notice, tone: .info).padding(.horizontal, AglynSpace.two)
      }
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  private var filtered: Bool { !model.search.isEmpty || model.read != nil || model.pickedForm != nil }

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
        message: filtered ? "Try another filter or search." : "What visitors send through your forms shows up here.")
    } else if selectable {
      List(selection: $selection) { rows(selectable: true) }
        .onChange(of: model.rows, initial: true) { _, rows in
          if selection == nil { selection = rows.first?.id }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynListBackground()
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
          SubmissionListRow(row: row, showForm: formID == nil, now: now).tag(row.id)
        } else {
          Button {
            pushed = row.id
          } label: {
            SubmissionListRow(row: row, showForm: formID == nil, now: now)
          }
          .buttonStyle(.plain)
        }
      }
      .swipeActions(edge: .trailing) {
        Button(role: .destructive) { ask(delete: row) } label: { Label("Delete", systemImage: "trash") }
          .disabled(!role.canEditContent)
      }
      .swipeActions(edge: .leading) {
        Button { toggleRead(row) } label: {
          Label(row.read ? "Unread" : "Read", systemImage: row.read ? InboxSymbols.unread : InboxSymbols.read)
        }
        .tint(AglynColor.primary)
        .disabled(!role.canEditContent)
      }
      .contextMenu {
        Button { toggleRead(row) } label: {
          Label(row.read ? "Mark as unread" : "Mark as read", systemImage: row.read ? InboxSymbols.unread : InboxSymbols.read)
        }
        .disabled(!role.canEditContent)
        if row.sender.email != nil {
          Button { replying = row } label: { Label("Reply", systemImage: InboxSymbols.reply) }
            .disabled(!role.canEditContent)
        }
        Button(role: .destructive) { ask(delete: row) } label: { Label("Delete", systemImage: "trash") }
          .disabled(!role.canEditContent)
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

  private func detail(_ id: String, titled: Bool) -> some View {
    SubmissionDetailView(
      context: context, submissionID: id, runner: runner, role: role, siteName: siteName, titled: titled,
      onRead: { model.patch($0, read: $1) }, toggleRead: toggleRead, reply: { replying = $0 }, delete: ask(delete:))
  }

  private func ask(delete submission: Submission) {
    runner.clear()
    deleting = submission
  }

  private func toggleRead(_ submission: Submission) {
    guard let api else { return }
    let next = !submission.read
    runner.run {
      try await api.setRead(submission.id, read: next)
      model.patch(submission.id, read: next)
    }
  }

  private func delete(_ submission: Submission) {
    guard let api else { return }
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
        let subtitle = [showForm ? row.formName : nil, row.preview.isEmpty ? nil : row.preview]
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
