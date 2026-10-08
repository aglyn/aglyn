// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * WRITING AN EMAIL (the Kotlin plugin's `ComposeDialog`), as the console's
 * campaign composer posts it to `POST /api/campaigns/send`:
 *
 *   - the audience is one pick packing kind and id (`leads`, `members`,
 *     `list:{id}`, `segment:{id}`), split once into `audience`, `listId` and
 *     `segmentId` so the count and the send ask for the same people;
 *   - the count is the route's own `preview` dry run, never a count of ours;
 *   - a designed email names its Besigner design (`templateScreenId`) and
 *     sends no body; "Edit design" opens that design in the Besigner;
 *   - Save draft is `draft` on an existing email; Send is a send, or
 *     `schedule` with `sendAtMs` when a time is picked.
 */

/// The audience pick, as the composer stores it.
struct AudiencePick: Equatable {
  var raw: String

  var kind: String {
    if raw.hasPrefix("segment:") { return "segment" }
    if raw.hasPrefix("list:") { return "list" }
    return raw
  }

  var listID: String? { raw.hasPrefix("list:") ? String(raw.dropFirst("list:".count)) : nil }
  var segmentID: String? { raw.hasPrefix("segment:") ? String(raw.dropFirst("segment:".count)) : nil }

  /// What the confirm names a person in this audience.
  var personLabel: String {
    switch kind {
    case "leads": "lead"
    case "members": "site member"
    case "list": "list subscriber"
    default: "contact in the segment"
    }
  }

  /// A stored email's audience, back in the picker's form.
  static func stored(_ data: [String: Any]) -> AudiencePick? {
    guard let audience = data["audience"] as? String, !audience.isEmpty else { return nil }
    if audience == "list", let id = data["listId"] as? String, !id.isEmpty { return AudiencePick(raw: "list:\(id)") }
    if audience == "segment", let id = data["segmentId"] as? String, !id.isEmpty { return AudiencePick(raw: "segment:\(id)") }
    return AudiencePick(raw: audience)
  }
}

/// The dry run's answer: who this send reaches.
struct AudiencePreview: Equatable {
  var sendable: Int
  var audienceSize: Int
  var audienceTruncated: Bool
  var suppressed: Int
  var consentWithheld: Int
  var blocking: Bool = false
  var error: String?
}

struct ComposeDraft: Equatable {
  var subject = ""
  var preheader = ""
  var fromName = ""
  var replyTo = ""
  var senderID = ""
  var topicID = ""
  var audience = AudiencePick(raw: "leads")
  var designed = false
  var templateScreenID = ""
  var body = ""
  var schedule = false
  var sendAt = Date().addingTimeInterval(3600)
  var campaignID = ""

  init() {}

  init(_ send: EmailSend) {
    let data = send.data
    func text(_ key: String) -> String { data[key] as? String ?? "" }
    subject = text("subject")
    preheader = text("preheader")
    fromName = text("fromName")
    replyTo = text("replyTo")
    senderID = text("senderId")
    topicID = text("topicId")
    audience = AudiencePick.stored(data) ?? AudiencePick(raw: "leads")
    templateScreenID = text("templateScreenId")
    designed = !templateScreenID.isEmpty
    body = text("body")
    campaignID = text("emailCampaignId")
    if send.status == "scheduled", let at = send.sendAt {
      schedule = true
      sendAt = at
    }
  }

  var messageReady: Bool { designed ? !templateScreenID.isEmpty : !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  var canSend: Bool { !subject.trimmingCharacters(in: .whitespaces).isEmpty && messageReady }

  /// The fields every request that resolves the audience carries.
  var audienceFields: [String: Any?] {
    var fields: [String: Any?] = ["audience": audience.kind]
    if let id = audience.listID { fields["listId"] = id }
    if let id = audience.segmentID { fields["segmentId"] = id }
    if !topicID.isEmpty { fields["topicId"] = topicID }
    if !senderID.isEmpty { fields["senderId"] = senderID }
    return fields
  }

  /// The message itself, as `draft`, `send` and `schedule` post it.
  var messageFields: [String: Any?] {
    var fields = audienceFields
    fields["subject"] = subject.trimmingCharacters(in: .whitespaces)
    fields["body"] = designed ? "" : body.trimmingCharacters(in: .whitespacesAndNewlines)
    if designed && !templateScreenID.isEmpty { fields["templateScreenId"] = templateScreenID }
    if !campaignID.isEmpty { fields["emailCampaignId"] = campaignID }
    fields["fromName"] = fromName.trimmingCharacters(in: .whitespaces)
    fields["replyTo"] = replyTo.trimmingCharacters(in: .whitespaces)
    fields["preheader"] = preheader.trimmingCharacters(in: .whitespaces)
    return fields
  }
}

extension CampaignSendAPI {
  func preview(_ draft: ComposeDraft) async -> AudiencePreview {
    var fields = draft.audienceFields
    fields["action"] = "preview"
    do {
      let answer = try await compose(fields)
      return AudiencePreview(
        sendable: Int(answer?["sendable"]?.numberValue ?? 0), audienceSize: Int(answer?["audienceSize"]?.numberValue ?? 0),
        audienceTruncated: answer?["audienceTruncated"]?.boolValue == true, suppressed: Int(answer?["suppressed"]?.numberValue ?? 0),
        consentWithheld: Int(answer?["consentWithheld"]?.numberValue ?? 0))
    } catch let error as ConsoleAPIError {
      return AudiencePreview(
        sendable: 0, audienceSize: 0, audienceTruncated: false, suppressed: 0, consentWithheld: 0, blocking: error.status == 409,
        error: error.message)
    } catch {
      return AudiencePreview(
        sendable: 0, audienceSize: 0, audienceTruncated: false, suppressed: 0, consentWithheld: 0, error: problemText(error))
    }
  }

  @discardableResult
  func compose(_ fields: [String: Any?]) async throws -> JSONValue? {
    var all = fields
    all["hostId"] = hostID
    return try await api.request(campaignSendRoute, method: .post, body: jsonBody(all))
  }
}

/// A site's email designs, senders, lists, segments and topics: what the composer's pickers offer.
@MainActor
@Observable
final class ComposeOptions {
  @ObservationIgnored let designs = LiveQueryList(pageSize: 200) { $0 }
  @ObservationIgnored let lists = LiveQueryList(pageSize: 50) { $0 }
  @ObservationIgnored let segments = LiveQueryList(pageSize: 50) { $0 }
  @ObservationIgnored let topics = LiveQueryList(pageSize: 50) { $0 }

  func start(_ reader: FirestoreReader, orgID: String, hostID: String) {
    designs.show(reader) { _ in FirestoreQuery(["hosts", hostID, "screens"], limit: 200) }
    lists.show(reader) { _ in FirestoreQuery(["orgs", orgID, "lists"], limit: 50) }
    segments.show(reader) { _ in FirestoreQuery(["orgs", orgID, "contactSegments"], limit: 50) }
    topics.show(reader) { _ in FirestoreQuery(["orgs", orgID, "emailTopics"], limit: 50) }
  }

  func stop() {
    for list in [designs, lists, segments, topics] { list.stop() }
  }

  private func sorted(_ docs: [FirestoreDocument], _ key: String) -> [(id: String, name: String)] {
    docs.map { (id: $0.id, name: $0.string(key).flatMap { $0.isEmpty ? nil : $0 } ?? $0.id) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  /// Email designs: screens of kind `email` not deleted, by name.
  var emailDesigns: [(id: String, name: String, versionID: String?)] {
    designs.rows.filter { $0.string("kind") == "email" && $0.data["deletedAt"] == nil }
      .map { (id: $0.id, name: $0.string("displayName") ?? "Untitled email", versionID: $0.string("versionId")) }
      .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
  }

  /// The site's senders, from the sending identity route (the composer's own source: who the site may send as).
  var senders: [SenderRow] = []

  var senderOptions: [(id: String, name: String)] {
    senders.map { sender in
      let name = [sender.fromName, sender.from].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
      return (id: sender.id, name: name.isEmpty ? sender.localPart : name)
    }
  }

  var listOptions: [(id: String, name: String)] { sorted(lists.rows, "name") }
  var segmentOptions: [(id: String, name: String)] { sorted(segments.rows, "name") }
  var topicOptions: [(id: String, name: String)] { sorted(topics.rows.filter { $0.bool("archived") != true }, "name") }
}

/// Writes a new email, or edits a draft or scheduled one, the way the console's composer does.
struct ComposeSheet: View {
  let context: NativePluginContext
  let send: EmailSend?
  let siteName: String?
  var campaignID: String?
  @Environment(\.dismiss) private var dismiss
  @State private var draft = ComposeDraft()
  @State private var options = ComposeOptions()
  @State private var preview: AudiencePreview?
  @State private var confirming = false
  @State private var busy = false
  @State private var error: String?
  @State private var seeded = false

  private var api: CampaignSendAPI? { context.hostID.map { CampaignSendAPI(api: context.api, hostID: $0) } }

  var body: some View {
    NavigationStack {
      Form {
        if let error { AglynNotice(error, tone: .error) }
        Section("Message") {
          TextField("Subject", text: $draft.subject).accessibilityIdentifier("compose-subject")
          TextField("Preview text", text: $draft.preheader)
          Picker("Content", selection: $draft.designed) {
            Text("Plain message").tag(false)
            Text("Designed email").tag(true)
          }
          .pickerStyle(.segmented)
          if draft.designed {
            Picker("Design", selection: $draft.templateScreenID) {
              Text("Choose a design").tag("")
              ForEach(options.emailDesigns, id: \.id) { Text($0.name).tag($0.id) }
            }
            .accessibilityIdentifier("compose-design")
            if let design = options.emailDesigns.first(where: { $0.id == draft.templateScreenID }), let version = design.versionID {
              Button {
                context.openBesigner("/screens/\(design.id)/versions/\(version)/besigner")
              } label: {
                Label("Edit design", systemImage: "paintbrush")
              }
            }
            if options.emailDesigns.isEmpty {
              Text("This site has no email designs yet. Make one under Templates.").font(AglynFont.caption).foregroundStyle(.secondary)
            }
          } else {
            TextField("Message", text: $draft.body, axis: .vertical)
              .lineLimit(6...16)
              .accessibilityIdentifier("compose-body")
          }
        }
        Section {
          Picker("Send to", selection: $draft.audience.raw) {
            Text("Leads").tag("leads")
            Text("Site members").tag("members")
            ForEach(options.listOptions, id: \.id) { Text("List: \($0.name)").tag("list:\($0.id)") }
            ForEach(options.segmentOptions, id: \.id) { Text("Segment: \($0.name)").tag("segment:\($0.id)") }
          }
          .accessibilityIdentifier("compose-audience")
          if !options.topicOptions.isEmpty {
            Picker("Topic", selection: $draft.topicID) {
              Text("Marketing").tag("")
              ForEach(options.topicOptions, id: \.id) { Text($0.name).tag($0.id) }
            }
          }
          reach
        } header: {
          Text("Audience")
        } footer: {
          Text("Who it reaches is counted the way the send counts it: after consent, suppressions and the monthly allowance.")
        }
        Section("Sent as") {
          if !options.senderOptions.isEmpty {
            Picker("Sender", selection: $draft.senderID) {
              Text("The site's default").tag("")
              ForEach(options.senderOptions, id: \.id) { Text($0.name).tag($0.id) }
            }
          }
          TextField("From name", text: $draft.fromName)
          TextField("Reply to", text: $draft.replyTo)
            .textContentType(.emailAddress)
            #if os(iOS)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
            #endif
        }
        Section("When") {
          Toggle("Schedule it", isOn: $draft.schedule)
          if draft.schedule {
            DatePicker("Send at", selection: $draft.sendAt, in: Date()...)
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(send == nil ? "Write an email" : "Edit email")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
        if send != nil {
          ToolbarItem(placement: .secondaryAction) {
            Button("Save draft") { Task { await saveDraft() } }.disabled(busy).accessibilityIdentifier("compose-save-draft")
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(draft.schedule ? "Schedule" : "Send") { confirming = true }
            .disabled(busy || !draft.canSend || preview?.blocking == true)
            .accessibilityIdentifier("compose-send")
        }
      }
      .confirmationDialog(
        draft.schedule ? "Schedule this campaign?" : "Send this campaign?", isPresented: $confirming, titleVisibility: .visible
      ) {
        Button(draft.schedule ? "Schedule" : "Send") { Task { await sendNow() } }
      } message: {
        Text(confirmText)
      }
      .task {
        guard !seeded, let orgID = context.orgID, let hostID = context.hostID else { return }
        seeded = true
        if let send { draft = ComposeDraft(send) } else if let campaignID { draft.campaignID = campaignID }
        if draft.fromName.isEmpty, let siteName { draft.fromName = siteName }
        options.start(context.firestore, orgID: orgID, hostID: hostID)
        options.senders = SendingView(try? await context.api.request(sendingIdentityRoute, query: [("hostId", hostID)])).senders
      }
      .task(id: "\(draft.audience.raw)|\(draft.topicID)|\(draft.senderID)") {
        guard let api else { return }
        preview = nil
        try? await Task.sleep(for: .milliseconds(350))
        if Task.isCancelled { return }
        preview = await api.preview(draft)
      }
      .onDisappear { options.stop() }
    }
    .frame(minWidth: 420, minHeight: 560)
  }

  @ViewBuilder
  private var reach: some View {
    if let preview {
      if let error = preview.error {
        Text(error).foregroundStyle(preview.blocking ? AglynColor.error : .secondary).font(AglynFont.subheadline)
      } else {
        LabeledContent("Reaches", value: "\(grouped(preview.sendable)) of \(grouped(preview.audienceSize))\(preview.audienceTruncated ? "+" : "")")
          .accessibilityIdentifier("compose-reach")
        if preview.suppressed > 0 { LabeledContent("Suppressed", value: grouped(preview.suppressed)) }
        if preview.consentWithheld > 0 { LabeledContent("No consent basis", value: grouped(preview.consentWithheld)) }
      }
    } else {
      HStack {
        ProgressView()
        Text("Counting who it reaches…").foregroundStyle(.secondary)
      }
    }
  }

  /// What the confirm says: how many, of how many, or that the count could not be read.
  private var confirmText: String {
    let quoted = "“\(draft.subject.trimmingCharacters(in: .whitespaces))”"
    let when = draft.schedule ? " on \(draft.sendAt.formatted(date: .abbreviated, time: .shortened))" : ""
    guard let preview, preview.error == nil else {
      let reason = preview?.error.map { " (\($0))" } ?? ""
      return "\(quoted) goes to every \(draft.audience.personLabel) who hasn't unsubscribed\(when). The recipient count could not be read\(reason), so how many that is is not known."
    }
    let people = preview.sendable == 1 ? draft.audience.personLabel : "\(draft.audience.personLabel)s"
    if preview.sendable < preview.audienceSize {
      return "\(quoted) goes to \(grouped(preview.sendable)) of \(grouped(preview.audienceSize)) \(people)\(when). The rest are not sent this email."
    }
    return "\(quoted) goes to \(grouped(preview.sendable)) \(people)\(when)."
  }

  private func fields(_ action: String?) -> [String: Any?] {
    var fields = draft.messageFields
    if let action { fields["action"] = action }
    if let send { fields["campaignId"] = send.id }
    return fields
  }

  private func saveDraft() async {
    guard let api else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await api.compose(fields("draft"))
      dismiss()
    } catch {
      self.error = problemText(error)
    }
  }

  private func sendNow() async {
    guard let api else { return }
    if draft.schedule && draft.sendAt <= Date() {
      error = "Pick a future send time."
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    var all = fields(draft.schedule ? "schedule" : nil)
    if draft.schedule { all["sendAtMs"] = Int64(draft.sendAt.timeIntervalSince1970 * 1000) }
    do {
      try await api.compose(all)
      dismiss()
    } catch {
      self.error = problemText(error)
    }
  }
}
