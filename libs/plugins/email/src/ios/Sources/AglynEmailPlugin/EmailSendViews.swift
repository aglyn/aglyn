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

func sendTone(_ state: String) -> AglynTone {
  switch state {
  case "sent": .success
  case "sending", "pending": .info
  case "held": .warning
  case "stopped": .error
  default: .neutral
  }
}

/// Whether the member may send from this site: an admin or editor of it, as the route asks.
@MainActor
@Observable
final class SiteRoleModel {
  @ObservationIgnored let doc = ObservedDocument()
  private var uid = ""

  func start(_ context: NativePluginContext) {
    uid = context.uid
    if let hostID = context.hostID { doc.start(context.firestore, ["hosts", hostID]) }
  }

  var role: String? { (doc.document?.data["memberRoles"] as? [String: Any])?[uid] as? String }
  var canSend: Bool { ["owner", "admin", "editor"].contains(role ?? "") }
  var siteName: String? { doc.document?.string("displayName") ?? doc.document?.string("name") }
}

/// A site's emails: Status chips and a subject search; the picked email beside the list in a wide window.
struct EmailsScreen: View {
  let context: NativePluginContext
  var initial: String?
  var composeCampaign: String?
  @State private var list = LiveQueryList(pageSize: emailsPageSize, map: emailSend)
  @State private var role = SiteRoleModel()
  @State private var status = "all"
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var composing = false

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          listPane(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection, let orgID = context.orgID, let hostID = context.hostID {
              EmailDetail(context: context, orgID: orgID, hostID: hostID, sendID: selection, canSend: role.canSend).id(selection)
            } else {
              AglynEmptyState("Pick an email to see how it did", systemImage: "envelope")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        listPane(selectable: false)
      }
    }
    .navigationTitle("Emails")
    .searchable(text: $searchText, prompt: "Search subjects")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if role.canSend {
        ToolbarItem(placement: .primaryAction) {
          Button {
            composing = true
          } label: {
            Label("Write an email", systemImage: "square.and.pencil")
          }
          .keyboardShortcut("n", modifiers: .command)
          .accessibilityIdentifier("email-compose")
        }
      }
    }
    .sheet(isPresented: $composing) { ComposeSheet(context: context, send: nil, siteName: role.siteName, campaignID: composeCampaign) }
    .task(id: composeCampaign) { if composeCampaign != nil { composing = true } }
    .task(id: "\(status)|\(search)|\(context.hostID ?? "")") {
      role.start(context)
      if selection == nil { selection = initial }
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      let status = status, search = search
      list.show(context.firestore) { emailsQuery(orgID: orgID, hostID: hostID, status: status, search: search, limit: $0) }
    }
    .onDisappear { list.stop() }
  }

  @ViewBuilder
  private func listPane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          ForEach(sendStatusFilters, id: \.0) { value, label in
            AglynChoiceChip(label, selected: status == value) { status = value }
          }
        }
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
      }
      if !list.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if let failure = list.failure {
        AglynEmptyState("Could not load emails", systemImage: "exclamationmark.triangle", message: failure) { Button("Try again") { list.retry() } }
      } else if list.rows.isEmpty {
        AglynEmptyState(
          status == "all" && search.isEmpty ? "No emails yet" : "No emails match", systemImage: "envelope",
          message: "Emails you write to your audiences show up here, with how each one did.")
      } else if selectable {
        List(selection: $selection) { rows(selectable: true) }.aglynListBackground()
      } else {
        List { rows(selectable: false) }.refreshable { list.retry() }.aglynListBackground()
      }
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(list.rows) { send in
      Group {
        if selectable {
          EmailRow(send: send).tag(send.id)
        } else if let orgID = context.orgID, let hostID = context.hostID {
          NavigationLink {
            EmailDetail(context: context, orgID: orgID, hostID: hostID, sendID: send.id, canSend: role.canSend)
          } label: {
            EmailRow(send: send)
          }
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("email-\(send.id)")
    }
    if list.hasMore { Button("Show more emails") { list.loadMore() }.frame(maxWidth: .infinity) }
  }
}

struct EmailRow: View {
  let send: EmailSend

  var body: some View {
    AglynRow(
      send.subject,
      subtitle: [send.audienceLabel, (send.sendAt ?? send.createdAt).map { relativeTime($0) }].compactMap { $0 }.joined(separator: " · "),
      systemImage: "envelope"
    ) {
      StatusChip(["draft", "held"].contains(send.display.state) ? send.display.label : send.display.state.capitalized, tone: sendTone(send.display.state))
    }
  }
}

private enum SendSheet: String, Identifiable {
  case sendNow, followUp, cancel, test, rename, edit
  var id: String { rawValue }
}

/// One email: its state, who it went to, its report and links, and what can be done with it.
struct EmailDetail: View {
  let context: NativePluginContext
  let orgID: String
  let hostID: String
  let sendID: String
  let canSend: Bool
  @State private var doc = ObservedDocument()
  @State private var links = ObservedDocument()
  @State private var sheet: SendSheet?
  @State private var notice: String?

  private var api: CampaignSendAPI { CampaignSendAPI(api: context.api, hostID: hostID) }

  var body: some View {
    Group {
      if !doc.ready {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else if let document = doc.document {
        content(emailSend(document), document)
      } else {
        AglynEmptyState("This email is gone", systemImage: "envelope", message: "A draft that was discarded leaves no trace.")
      }
    }
    .task(id: sendID) {
      doc.start(context.firestore, campaignSendsPath(orgID) + [sendID])
      links.start(context.firestore, campaignSendsPath(orgID) + [sendID, "reports", "links"])
    }
    .onDisappear {
      doc.stop()
      links.stop()
    }
  }

  @ViewBuilder
  private func content(_ send: EmailSend, _ document: FirestoreDocument) -> some View {
    let report = campaignReport(document.data["stats"] as? [String: Any])
    let linkReport = sendLinkReport(links.document?.data)
    let sentAs = document.data["sentAs"] as? [String: Any]
    Form {
      if let notice { AglynNotice(notice, tone: .success) { self.notice = nil } }
      if send.held {
        AglynNotice(
          "This email is held for review before it sends. Our team reviews it, and it sends automatically if it is approved or is canceled if it is not. Nothing has been sent or counted.",
          tone: .warning)
      }
      Section {
        HStack(alignment: .firstTextBaseline) {
          Text(send.subject).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
          Spacer()
          StatusChip(send.display.label, tone: sendTone(send.display.state))
        }
        Text(
          [
            send.audienceLabel, send.status == "scheduled" ? send.sendAt.map { "Scheduled for \($0.formatted(date: .abbreviated, time: .shortened))" } : nil,
          ].compactMap { $0 }.joined(separator: " · ")
        ).font(AglynFont.subheadline).foregroundStyle(.secondary)
        if canSend {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack {
              if send.canSendNow { Button("Send now") { sheet = .sendNow }.buttonStyle(.borderedProminent).accessibilityIdentifier("email-send-now") }
              if send.canFollowUp { Button("Send to more") { sheet = .followUp }.buttonStyle(.borderedProminent) }
              if send.canCompose { Button("Edit") { sheet = .edit }.buttonStyle(.bordered).accessibilityIdentifier("email-edit") }
              if send.canCompose { Button("Send a test") { sheet = .test }.buttonStyle(.bordered).accessibilityIdentifier("email-test") }
              if send.canStop { Button("Stop sending", role: .destructive) { sheet = .cancel }.buttonStyle(.bordered) }
              if send.canCancel { Button("Cancel send", role: .destructive) { sheet = .cancel }.buttonStyle(.bordered) }
              Button("Rename") { sheet = .rename }.buttonStyle(.bordered)
            }
          }
        }
      }
      Section("Sent as") {
        PropertyRow("From", [sentAs?["fromName"] as? String ?? document.string("fromName"), sentAs?["from"] as? String].compactMap { $0 }.joined(separator: " · "))
        PropertyRow("Reply to", sentAs?["replyTo"] as? String ?? document.string("replyTo"))
        PropertyRow("Preview text", document.string("preheader"))
        PropertyRow("Design", document.string("templateScreenId") != nil ? "Designed email" : "Plain message")
      }
      if send.status != "draft" {
        Section("Delivery") {
          LabeledContent("Sent", value: grouped(report.sent))
          LabeledContent("Addressed", value: grouped(report.recipients))
          LabeledContent("Delivered", value: report.delivered.map { "\(grouped($0)) · \(percent(report.rates["delivery"] ?? nil))" } ?? "Not recorded")
          LabeledContent("Bounced", value: "\(grouped(report.bounced)) · \(percent(report.rates["bounce"] ?? nil))")
          LabeledContent("Complaints", value: "\(grouped(report.complained)) · \(percent(report.rates["complaint"] ?? nil))")
        }
        Section("Engagement") {
          LabeledContent("Opened", value: "\(report.uniqueOpens.map(grouped) ?? "—") · \(percent(report.rates["open"] ?? nil))")
          LabeledContent("Clicked", value: "\(report.uniqueClicks.map(grouped) ?? "—") · \(percent(report.rates["click"] ?? nil))")
          LabeledContent("Click to open", value: percent(report.rates["clickToOpen"] ?? nil))
          LabeledContent("All opens", value: grouped(report.opens))
          LabeledContent("All clicks", value: grouped(report.clicks))
          LabeledContent("Unsubscribed", value: "\(grouped(report.unsubscribes)) · \(percent(report.rates["unsubscribe"] ?? nil))")
        }
        if !report.populations.isEmpty {
          Section("Who was left out") {
            ForEach(report.populations, id: \.id) { LabeledContent($0.label, value: "\(grouped($0.count)) of \(grouped($0.of)) \($0.ofLabel)") }
          }
        }
        if !linkReport.rows.isEmpty {
          Section("Links") {
            ForEach(linkReport.rows, id: \.url) { LabeledContent($0.url, value: "\(grouped($0.clicks)) · \(percent($0.share))") }
          }
        }
        ForEach(report.caveats, id: \.id) { AglynNotice($0.message, tone: .info) }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle(send.subject)
    .sheet(item: $sheet) { kind in sendSheet(kind, send) }
  }

  @ViewBuilder
  private func sendSheet(_ kind: SendSheet, _ send: EmailSend) -> some View {
    switch kind {
    case .sendNow:
      CountedConfirmSheet(
        title: "Send this email now?", confirm: "Send now", count: { try await api.sendNowCount(send.id) },
        message: { "This sends it to \(grouped($0)) \($0 == 1 ? "person" : "people") straight away. It cannot be taken back once it goes." },
        nobody: "Nobody in this audience can be sent to right now."
      ) {
        try await api.sendNow(send.id)
        notice = "It is on its way."
      }
    case .followUp:
      CountedConfirmSheet(
        title: "Send this email to more people?", confirm: "Send", count: { try await api.followUpCount(send.id) },
        message: { "This sends the same email to \(grouped($0)) more in the same audience. Those who already received it are not sent it again." },
        nobody: "Everyone in the audience has it already."
      ) {
        try await api.followUp(send.id)
        notice = "It is on its way to the rest."
      }
    case .cancel:
      CountedConfirmSheet(
        title: send.midFlight ? "Stop sending this email?" : "Cancel this scheduled email?", confirm: send.midFlight ? "Stop sending" : "Cancel send",
        count: nil,
        message: { _ in
          send.midFlight
            ? "It has reached \(grouped(send.display.progress.reached)) so far. What has gone out cannot be taken back, and a stopped send cannot be resumed."
            : "It will not be sent at the time it is scheduled for. A canceled email cannot be put back on the schedule."
        }, nobody: ""
      ) {
        try await api.cancel(send.id)
        notice = send.midFlight ? "Sending stopped." : "Canceled."
      }
    case .rename:
      RenameSheet(initial: send.data["displayName"] as? String ?? send.subject) {
        try await api.rename(send.id, $0)
        notice = "Renamed."
      }
    case .test:
      TestSendSheet(api: api, message: testMessage(send)) { notice = "Test sent to \($0)." }
    case .edit:
      ComposeSheet(context: context, send: send, siteName: nil)
    }
  }
}

/// Counts who an act reaches (the route's dry run), says so, and confirms.
struct CountedConfirmSheet: View {
  let title: String
  let confirm: String
  let count: (() async throws -> Int)?
  let message: (Int) -> String
  let nobody: String
  let run: () async throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var reaching: Int?
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        if count != nil && reaching == nil {
          ProgressView("Counting who it reaches…")
        } else if count != nil && reaching == 0 {
          Text(nobody)
        } else {
          Text(message(reaching ?? 0))
        }
      }
      .formStyle(.grouped)
      .navigationTitle(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Not now") { dismiss() }.disabled(busy) }
        ToolbarItem(placement: .confirmationAction) {
          Button(confirm) {
            busy = true
            Task {
              do {
                try await run()
                dismiss()
              } catch {
                self.error = problemText(error)
              }
              busy = false
            }
          }
          .disabled(busy || (count != nil && (reaching ?? 0) == 0))
        }
      }
      .task {
        guard let count else { return }
        do { reaching = try await count() } catch {
          reaching = 0
          self.error = problemText(error)
        }
      }
    }
    .frame(minWidth: 360, minHeight: 240)
  }
}

struct RenameSheet: View {
  let initial: String
  let save: (String) async throws -> Void
  @State private var name = ""

  var body: some View {
    AglynFormSheet("Rename this email", canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty, save: { try await save(name) }) {
      Section {
        TextField("Name", text: $name)
      } footer: {
        Text("The name is what your lists show; recipients see the subject.")
      }
    }
    .onAppear { if name.isEmpty { name = initial } }
  }
}

struct TestSendSheet: View {
  let api: CampaignSendAPI
  let message: [String: Any?]
  let onSent: (String) -> Void
  @State private var proofs: Proofs?
  @State private var to = ""
  @State private var persona = ""

  var body: some View {
    AglynFormSheet("Send a test", confirm: "Send test", canConfirm: !to.isEmpty, save: {
      try await api.test(message, to: to, persona: persona.isEmpty ? nil : persona)
      onSent(to)
    }) {
      Section {
        if let proofs {
          Picker("Send to", selection: $to) { ForEach(proofs.recipients, id: \.self) { Text($0).tag($0) } }
          Picker("Show it as", selection: $persona) {
            Text("Nobody in particular").tag("")
            ForEach(proofs.personas, id: \.email) { Text($0.name).tag($0.email) }
          }
        } else {
          ProgressView()
        }
      } footer: {
        Text("A test goes to one of these addresses only, and records nothing. The person it shows as is sent nothing.")
      }
    }
    .task {
      proofs = (try? await api.proofOptions()) ?? Proofs()
      to = proofs?.recipients.first ?? ""
    }
  }
}

