// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// One submission, live (the Kotlin `SubmissionDetail`): who sent it, from
/// which form and page, what they sent under the form's own question labels,
/// and read or unread, reply and delete. Opening an unread one marks it read,
/// as the console's dialog does.
struct SubmissionDetailView: View {
  let context: NativePluginContext
  let submissionID: String
  let runner: PluginActionRunner
  let role: SiteRoleModel
  /// False beside the list, where the screen's own title stays.
  var titled = true
  let onRead: (String, Bool) -> Void
  let toggleRead: (Submission) -> Void
  let reply: (Submission) -> Void
  let delete: (Submission) -> Void

  @State private var model = SubmissionModel()
  @State private var markedRead = false

  private var api: SubmissionsAPI? {
    context.hostID.map {
      SubmissionsAPI(api: context.api, writer: context.writer, firestore: context.firestore, hostID: $0)
    }
  }

  var body: some View {
    Group {
      if !model.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if model.failed && model.submission == nil {
        AglynEmptyState(
          "Could not load this submission", systemImage: "exclamationmark.triangle",
          message: "Check the connection and try again.")
      } else if let submission = model.submission {
        content(submission)
      } else {
        AglynEmptyState("This submission is gone", systemImage: InboxSymbols.inbox, message: "It may have been deleted.")
      }
    }
    .navigationTitle(titled ? (model.submission?.from ?? "Submission") : "Submissions")
    .task(id: submissionID) {
      markedRead = false
      if let hostID = context.hostID { model.start(context.firestore, hostID: hostID, id: submissionID) }
    }
    .onChange(of: model.submission?.read == false && role.canEditContent, initial: true) { _, unread in markIfUnread(unread) }
    .onDisappear { model.stop() }
  }

  /// Marks the opened submission read once per opening, so "Mark as unread" sticks.
  private func markIfUnread(_ unread: Bool) {
    guard unread, !markedRead, let api, let submission = model.submission else { return }
    markedRead = true
    Task {
      if (try? await api.setRead(submission.id, read: true)) != nil { onRead(submission.id, true) }
    }
  }

  private func content(_ submission: Submission) -> some View {
    let now = Date()
    let canEdit = role.canEditContent
    return Form {
      if titled, let error = runner.error {
        Section { AglynNotice(error, tone: .error) { runner.clear() } }
      }
      Section {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(submission.from).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
            if let email = submission.sender.email, email != submission.from {
              Text(email).font(AglynFont.subheadline).foregroundStyle(.secondary).textSelection(.enabled)
            }
          }
          Spacer(minLength: AglynSpace.one)
          Menu {
            Button { toggleRead(submission) } label: {
              Label(
                submission.read ? "Mark as unread" : "Mark as read",
                systemImage: submission.read ? InboxSymbols.unread : InboxSymbols.read)
            }
            .keyboardShortcut("u", modifiers: [.command, .shift])
            .disabled(!canEdit)
            Divider()
            Button(role: .destructive) { delete(submission) } label: { Label("Delete", systemImage: "trash") }
              .keyboardShortcut(.delete, modifiers: .command)
              .disabled(!canEdit)
          } label: {
            Label("More", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .accessibilityLabel("More actions")
          .accessibilityIdentifier("submission-actions")
        }
        AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.half) {
          StatusChip(submission.formName, tone: .info)
          if submission.repliedAt != nil { StatusChip("Replied", tone: .success) }
          if let kind = submission.capturedKind { StatusChip(kind == "lead" ? "Became a lead" : "Became a contact") }
          if !submission.read { StatusChip("Unread", tone: .warning) }
        }
        let received = [
          submission.createdAt.map { "Received " + relativeTime($0, now: now) }, submission.path.map { "from \($0)" },
        ].compactMap { $0 }.joined(separator: " ")
        if !received.isEmpty {
          Text(received).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if submission.sender.email != nil {
          Button {
            reply(submission)
          } label: {
            Label("Reply", systemImage: InboxSymbols.reply)
          }
          .buttonStyle(.borderedProminent)
          .disabled(!canEdit)
          .keyboardShortcut("r", modifiers: [.command, .shift])
          .accessibilityIdentifier("submission-reply")
        }
      }
      Section("What they sent") {
        if submission.fields.isEmpty {
          Text("This submission carried no fields.").foregroundStyle(.secondary)
        }
        ForEach(submission.orderedFields(model.order)) { field in
          LabeledContent(model.labels[field.key] ?? field.key) {
            Text(field.text.isEmpty ? "—" : field.text).textSelection(.enabled).multilineTextAlignment(.trailing)
          }
          .accessibilityIdentifier("submission-field-\(field.key)")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("submission-detail")
  }
}

/// A reply to the sender, sent from the site's address through the inbox reply route.
struct ReplySheet: View {
  let submission: Submission
  let api: SubmissionsAPI
  let runner: PluginActionRunner
  let close: () -> Void
  @State private var subject: String
  @State private var message = ""
  @FocusState private var messageFocused: Bool

  init(submission: Submission, api: SubmissionsAPI, runner: PluginActionRunner, close: @escaping () -> Void) {
    self.submission = submission
    self.api = api
    self.runner = runner
    self.close = close
    _subject = State(initialValue: "Re: \(submission.formName)")
  }

  private var canSend: Bool {
    !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !runner.busy
  }

  var body: some View {
    NavigationStack {
      Form {
        if let error = runner.error {
          Section { AglynNotice(error, tone: .error) }
        }
        Section {
          TextField("Subject", text: $subject).accessibilityIdentifier("reply-subject")
        } footer: {
          if let email = submission.sender.email { Text("Sent to \(email) from your site's address.") }
        }
        Section("Message") {
          TextEditor(text: $message)
            .focused($messageFocused)
            .frame(minHeight: 160)
            .accessibilityLabel("Message")
            .accessibilityIdentifier("reply-message")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Reply to \(submission.from)")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: close).disabled(runner.busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            let subject = subject.trimmingCharacters(in: .whitespacesAndNewlines)
            let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
            runner.run(success: "Reply sent.", onDone: close) {
              try await api.reply(submission.id, subject: subject, message: message)
            }
          } label: {
            if runner.busy { ProgressView() } else { Text("Send reply") }
          }
          .disabled(!canSend)
          .keyboardShortcut(.return, modifiers: .command)
          .accessibilityIdentifier("reply-send")
        }
      }
      .onAppear { messageFocused = true }
    }
    .frame(minWidth: 460, minHeight: 420)
  }
}
