// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import Foundation
import SwiftUI

/*
 * A quote's proofs and revisions (AGL-4096, AGL-4184), as the console's QuoteProofsSection has them: the current
 * revision's proofs (a picture for an image, a row naming anything else; both download), Add proof from this device
 * and From media library, what the customer last said with any files they sent, "Start revision N+1", and every earlier
 * revision as it was kept. Then the files a quote's request came with (QuoteRequestFilesSection). The server keeps the
 * files and hands them out (`POST /api/commerce/quote` proof-ticket, proof-finalize, proof-from-media, proof-remove,
 * start-revision, revisions, file).
 */

/// A file the quote lists: a proof, or one the customer sent. Never its storage path.
struct QuoteListedFile: Identifiable, Equatable {
  let id: String
  let name: String
  let contentType: String
  let size: Int

  init(id: String, name: String, contentType: String, size: Int) {
    self.id = id
    self.name = name
    self.contentType = contentType
    self.size = size
  }

  init?(_ value: JSONValue) {
    guard let id = value["id"]?.stringValue else { return nil }
    self.init(
      id: id, name: value["name"]?.stringValue ?? "", contentType: value["contentType"]?.stringValue ?? "",
      size: Int(value["size"]?.numberValue ?? 0))
  }
}

/// An earlier revision as the route lists it.
struct QuoteRevisionView: Identifiable, Equatable {
  let revision: Int
  let stage: String
  let closedAtMs: Double
  let proofs: [QuoteListedFile]
  let responses: [QuoteCustomerResponse]
  let responseFiles: [[QuoteListedFile]]
  var id: Int { revision }
}

private func quoteTime(_ ms: Double) -> String { formatReceiptTime(Int64(ms), timeZone: TimeZone.current.identifier) }

/// Fetches one of the quote's files with the member's token (`file`); nil when it is refused.
func fetchQuoteFile(_ context: NativePluginContext, quoteID: String, fileID: String, revision: Int?) async -> DownloadedFile? {
  var body: [String: JSONValue] = [
    "action": .string("file"), "hostId": .string(context.hostID ?? ""), "quoteId": .string(quoteID),
    "fileId": .string(fileID),
  ]
  if let revision { body["revision"] = .number(Double(revision)) }
  return try? await context.api.download("/api/commerce/quote", method: .post, body: .object(body))
}

/// A picture of an image proof, loaded with the member's token.
private struct QuoteProofThumbnail: View {
  let context: NativePluginContext
  let quoteID: String
  let file: QuoteListedFile
  let revision: Int?
  @State private var image: Image?

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8).fill(AglynColor.secondary.opacity(0.08))
      if let image {
        image.resizable().scaledToFit()
      } else {
        ProgressView().accessibilityLabel("Loading \(file.name)")
      }
    }
    .frame(width: 128, height: 96)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .task(id: file.id) {
      guard let data = await fetchQuoteFile(context, quoteID: quoteID, fileID: file.id, revision: revision)?.data else {
        return
      }
      #if canImport(UIKit)
        if let picture = UIImage(data: data) { image = Image(uiImage: picture) }
      #else
        if let picture = NSImage(data: data) { image = Image(nsImage: picture) }
      #endif
    }
  }
}

/// What the Proofs section is doing. The quote screen owns it, so the pickers and dialogs it opens hang off the screen,
/// never off a list row that scrolls away under them.
@MainActor @Observable
final class QuoteProofsModel {
  var context: NativePluginContext?
  var quoteID = ""
  var order: HostOrder?
  var onNotice: (String, AglynTone) -> Void = { _, _ in }

  var sending: (done: Int, total: Int)?
  var busy = false
  var pickSource: PickSource?
  var choosingFromLibrary = false
  var confirmingRevision = false
  var history: [QuoteRevisionView]?
  var historyError: String?
  var downloaded: DownloadedInvoice?

  var revision: Int { max(1, Int(order?.quote?.revision ?? 1)) }

  func configure(context: NativePluginContext, quoteID: String, order: HostOrder, onNotice: @escaping (String, AglynTone) -> Void) {
    self.context = context
    self.quoteID = quoteID
    self.order = order
    self.onNotice = onNotice
  }

  // MARK: Acts

  func post(_ action: String, _ extra: [String: JSONValue] = [:]) async throws -> JSONValue? {
    var body: [String: JSONValue] = [
      "action": .string(action), "hostId": .string(context?.hostID ?? ""), "quoteId": .string(quoteID),
    ]
    body.merge(extra) { _, given in given }
    guard let context else { return nil }
    return try await context.api.request("/api/commerce/quote", method: .post, body: .object(body))
  }

  func reason(_ error: Error, _ fallback: String) -> String {
    ((error as? ConsoleAPIError)?.body?["error"]?.stringValue).flatMap { $0.isEmpty ? nil : $0 } ?? fallback
  }

  func download(_ file: QuoteListedFile, _ fromRevision: Int?) async {
    guard let context, let fetched = await fetchQuoteFile(context, quoteID: quoteID, fileID: file.id, revision: fromRevision) else {
      let fallback =
        order?.quote?.request != nil && fromRevision == nil && (order?.quote?.requestFiles ?? []).contains { $0.id == file.id }
        ? "The file could not be downloaded. The request may have been deleted from the Inbox."
        : "The file could not be downloaded"
      return onNotice(fallback, .error)
    }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(file.name.isEmpty ? file.id : file.name)
    do {
      try fetched.data.write(to: url)
      downloaded = DownloadedInvoice(url: url)
    } catch {
      onNotice("The file could not be downloaded", .error)
    }
  }

  func addProofs(_ files: [PickedFile]) async {
    let picked = files.map { (name: $0.name, contentType: $0.mimeType, size: $0.data.count) }
    if let problem = checkVisitorUploadSelection(picked, already: currentQuoteProofs(order?.quote).count) { return onNotice(problem, .error) }
    sending = (0, files.count)
    defer { sending = nil }
    for (index, file) in files.enumerated() {
      do {
        let ticket = try await post(
          "proof-ticket",
          [
            "file": .object([
              "name": .string(file.name), "contentType": .string(file.mimeType), "size": .number(Double(file.data.count)),
            ])
          ])
        guard let id = ticket?["ticket"]?.stringValue, let url = ticket?["upload"]?["url"]?.stringValue else {
          return onNotice("The file could not be sent. Check your connection and try again.", .error)
        }
        var fields: [(String, String)] = []
        if case .object(let raw)? = ticket?["upload"]?["fields"] {
          fields = raw.compactMap { key, value in value.stringValue.map { (key, $0) } }
        }
        guard let context else { return }
        try await context.api.postSignedForm(
          url, fields: fields, fileName: file.name, contentType: file.mimeType, data: file.data)
        _ = try await post("proof-finalize", ["ticket": .string(id)])
        sending = (index + 1, files.count)
      } catch {
        return onNotice(reason(error, "The proof could not be kept"), .error)
      }
    }
  }

  /// A file from the media library: the server copies its bytes into the quote's private proofs.
  func addFromLibrary(_ chosen: ChosenMedia) async {
    if let problem = quoteLibraryProofProblem(
      fileName: chosen.item.fileName, contentType: chosen.item.contentType, mediaID: chosen.item.id,
      mediaScope: chosen.scope.cdnScope)
    {
      return onNotice(problem, .error)
    }
    sending = (0, 1)
    defer { sending = nil }
    do {
      _ = try await post(
        "proof-from-media",
        ["media": .object(["mediaScope": .string(chosen.scope.cdnScope), "mediaId": .string(chosen.item.id)])])
    } catch {
      onNotice(reason(error, "The proof could not be added"), .error)
    }
  }

  func removeProof(_ id: String) async {
    busy = true
    defer { busy = false }
    do {
      _ = try await post("proof-remove", ["proofId": .string(id)])
    } catch {
      onNotice(reason(error, "The proof could not be removed"), .error)
    }
  }

  func startRevision() async {
    busy = true
    defer { busy = false }
    do {
      let answer = try await post("start-revision")
      let next = answer?["revision"]?.numberValue.map { Int($0) } ?? revision + 1
      onNotice("Revision \(next) started", .success)
    } catch {
      onNotice(reason(error, "The revision could not be started"), .error)
    }
  }

  func loadHistory() async {
    historyError = nil
    do {
      let answer = try await post("revisions")
      history = (answer?["revisions"]?.arrayValue ?? []).compactMap { entry in
        guard let number = entry["revision"]?.numberValue else { return nil }
        let responses = entry["responses"]?.arrayValue ?? []
        return QuoteRevisionView(
          revision: Int(number), stage: entry["stage"]?.stringValue ?? "",
          closedAtMs: entry["closedAtMs"]?.numberValue ?? 0,
          proofs: (entry["proofs"]?.arrayValue ?? []).compactMap(QuoteListedFile.init),
          responses: responses.compactMap { raw in
            // The listed files carry no storage path, so they are read apart (`responseFiles`).
            guard case .object(var fields) = raw else { return nil }
            fields["files"] = nil
            guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
            return try? JSONDecoder().decode(QuoteCustomerResponse.self, from: data)
          },
          responseFiles: responses.map { ($0["files"]?.arrayValue ?? []).compactMap(QuoteListedFile.init) })
      }
    } catch {
      historyError = reason(error, "Earlier revisions could not be loaded.")
    }
  }
}

/// The Proofs section, the earlier revisions and the request's files, for a quote screen's list. Its pickers and
/// dialogs are the screen's (`quoteProofsSheets`).
struct QuoteProofsSections: View {
  let context: NativePluginContext
  let order: HostOrder
  let quoteID: String
  @Bindable var model: QuoteProofsModel
  private var onNotice: (String, AglynTone) -> Void { model.onNotice }
  private var busy: Bool { model.busy }
  private var sending: (done: Int, total: Int)? { model.sending }
  private var history: [QuoteRevisionView]? { model.history }
  private var historyError: String? { model.historyError }

  private var quote: OrderQuote? { order.quote }
  private var revision: Int { max(1, Int(quote?.revision ?? 1)) }
  private var proofs: [QuoteProof] { currentQuoteProofs(quote) }
  private var proofOnly: Bool { quoteIsProofOnly(order) }
  private var canEdit: Bool { context.can(quoteEditPermission) }
  private var addRefusal: String? { quoteProofChangeRefusal(order, adding: true) }
  /// A quote with no lines keeps its last proof, so it offers no way to remove it.
  private var removable: Bool {
    quoteProofChangeRefusal(order, adding: false) == nil && !(proofOnly && proofs.count == 1)
  }

  var body: some View {
    Section {
      Text(quoteProofsExplanation(order)).foregroundStyle(.secondary)
      if let latest = latestQuoteResponse(quote) {
        responseNote(latest, files: (latest.files ?? []).map(listed), fromRevision: nil)
      }
      if proofs.isEmpty {
        Text(quoteNoProofsMessage(order)).foregroundStyle(.secondary)
      } else {
        ForEach(proofs, id: \.id) { proof in
          fileRow(listed(proof), fromRevision: nil, removable: removable)
        }
      }
      if isUnpaidQuote(order) { actions }
    } header: {
      Text("Proofs · Revision \(revision)")
    }
    .task(id: revision) { if revision > 1 { await model.loadHistory() } }
    if revision > 1 { earlierRevisions }
    requestFiles
  }

  // MARK: Rows

  private func listed(_ proof: QuoteProof) -> QuoteListedFile {
    QuoteListedFile(id: proof.id, name: proof.name, contentType: proof.contentType, size: Int(proof.size))
  }

  private func listed(_ file: QuoteResponseFile) -> QuoteListedFile {
    QuoteListedFile(id: file.id, name: file.name, contentType: file.contentType, size: Int(file.size))
  }

  /// A file: a picture for an image, its name and size for anything else; both download it.
  @ViewBuilder private func fileRow(_ file: QuoteListedFile, fromRevision: Int?, removable: Bool) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if visitorUploadIsInline(file.contentType) {
        QuoteProofThumbnail(context: context, quoteID: quoteID, file: file, revision: fromRevision)
      }
      Button("\(file.name) · \(formatVisitorUploadBytes(file.size))") { Task { await model.download(file, fromRevision) } }
        .buttonStyle(.borderless)
        .accessibilityHint("Download \(file.name)")
      if removable {
        Button("Remove", role: .destructive) {
          guard canEdit else { return onNotice(context.refusal(quoteEditPermission), .info) }
          Task { await model.removeProof(file.id) }
        }
        .buttonStyle(.borderless)
        .disabled(busy)
        .accessibilityLabel("Remove \(file.name)")
      }
    }
    .padding(.vertical, AglynSpace.half)
  }

  /// What the customer said, with any files they sent (the console's QuoteResponseNote).
  @ViewBuilder private func responseNote(
    _ response: QuoteCustomerResponse, files: [QuoteListedFile], fromRevision: Int?
  ) -> some View {
    let approved = response.action == .approve
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text(quoteResponseHeadline(response, at: quoteTime)).font(AglynFont.subheadline)
      if approved {
        if let confirmed = response.confirmed, !confirmed.isEmpty {
          Text("They confirmed:").font(AglynFont.subheadline)
          ForEach(confirmed, id: \.self) { Text("• \($0)").font(AglynFont.subheadline) }
        }
        let from = [response.ip.map { "From \($0)" } ?? "", response.userAgent ?? ""].filter { !$0.isEmpty }
        if !from.isEmpty { Text(from.joined(separator: " · ")).font(AglynFont.caption).foregroundStyle(.secondary) }
      } else {
        Text(response.comment ?? "").font(AglynFont.subheadline)
        ForEach(files) { file in fileRow(file, fromRevision: fromRevision, removable: false) }
      }
    }
    .padding(.vertical, AglynSpace.half)
    .listRowBackground((approved ? AglynTone.success : AglynTone.warning).color.opacity(0.12))
  }

  @ViewBuilder private var actions: some View {
    let refusal = !canEdit ? context.refusal(quoteEditPermission) : addRefusal
    Menu {
      ForEach(PickSource.available) { option in
        Button(option.label) {
          if let refusal { onNotice(refusal, .info) } else { model.pickSource = option }
        }
      }
    } label: {
      Text(sending.map { "Sending \($0.done + 1) of \($0.total)…" } ?? "Add proof")
    }
    .disabled(busy || sending != nil)
    .accessibilityIdentifier("quote-add-proof")
    Button("From media library") {
      if let refusal { onNotice(refusal, .info) } else { model.choosingFromLibrary = true }
    }
    .disabled(busy || sending != nil)
    .accessibilityIdentifier("quote-proof-library")
    Button("Start revision \(revision + 1)") {
      if canEdit { model.confirmingRevision = true } else { onNotice(context.refusal(quoteEditPermission), .info) }
    }
    .disabled(busy || sending != nil)
    .accessibilityIdentifier("quote-start-revision")
    Text("Up to \(quoteMaxProofs) files, \(formatVisitorUploadBytes(visitorUploadMaxBytes)) each.")
      .font(AglynFont.caption).foregroundStyle(.secondary)
  }

  @ViewBuilder private var earlierRevisions: some View {
    Section("Earlier revisions") {
      if let historyError { AglynNotice(historyError, tone: .error) }
      if history == nil && historyError == nil { ProgressView().accessibilityLabel("Loading earlier revisions") }
      ForEach((history ?? []).filter { $0.revision < revision }.reversed()) { entry in
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack {
            Text("Revision \(entry.revision)").font(AglynFont.strongSubheadline)
            let stage = QuoteStage(rawValue: entry.stage) ?? .unknown
            StatusChip(quoteStageLabels[stage] ?? entry.stage)
            Text("Replaced \(quoteTime(entry.closedAtMs))").font(AglynFont.caption).foregroundStyle(.secondary)
          }
          if entry.proofs.isEmpty { Text("No proofs.").foregroundStyle(.secondary) }
        }
        ForEach(entry.proofs) { proof in fileRow(proof, fromRevision: entry.revision, removable: false) }
        ForEach(Array(entry.responses.enumerated()), id: \.offset) { index, response in
          responseNote(
            response, files: index < entry.responseFiles.count ? entry.responseFiles[index] : [], fromRevision: entry.revision)
        }
      }
    }
  }

  /// The files a quote's request came with, as the customer's files (QuoteRequestFilesSection).
  @ViewBuilder private var requestFiles: some View {
    if let request = quote?.request {
      let files = (quote?.requestFiles ?? []).map(listed)
      let when = request.receivedAtMs.map { " on \(quoteTime($0))" } ?? ""
      Section("From the request") {
        Text("Sent through “\(request.formName)”\(when)." + (files.isEmpty ? " They sent no files." : " The files they sent:"))
          .foregroundStyle(.secondary)
        ForEach(files) { file in fileRow(file, fromRevision: nil, removable: false) }
      }
    }
  }

}

extension View {
  /// The Proofs section's pickers and dialogs, on the quote screen itself.
  func quoteProofsSheets(_ model: QuoteProofsModel, context: NativePluginContext) -> some View {
    @Bindable var model = model
    let revision = model.revision
    return
      self
      .aglynMediaPicker($model.pickSource) { files in Task { await model.addProofs(files) } }
      .sheet(isPresented: $model.choosingFromLibrary) {
        MediaChooserSheet(context: context, kind: nil, allowPrivate: true) { chosen in
          model.choosingFromLibrary = false
          Task { await model.addFromLibrary(chosen) }
        }
      }
      .sheet(item: $model.downloaded) { file in DownloadedInvoiceSheet(file: file) { model.downloaded = nil } }
      .confirmationDialog("Start revision \(revision + 1)?", isPresented: $model.confirmingRevision, titleVisibility: .visible) {
        Button("Start revision \(revision + 1)") { Task { await model.startRevision() } }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text(
          "Revision \(revision) is kept as it is now, with its proofs and the customer’s answers. Revision \(revision + 1) starts with no proofs, ready for new ones and any changes to the quote."
        )
      }
  }
}
