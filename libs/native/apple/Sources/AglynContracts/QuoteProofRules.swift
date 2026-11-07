// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's rules for a quote's proofs and revisions (AGL-4096, AGL-4184) and the file kinds a proof may be,
// ported once from libs/plugins/commerce/src/lib/model/commerce-quote-proofs.ts,
// libs/aglyn/src/lib/app-utils/visitor-upload.ts and components/console/quote-proofs.component.tsx, as the Kotlin kit's
// QuoteProofRules.kt. Held to the console's own spec cases in QuoteProofRulesTests.

/// The most proofs a revision holds (`QUOTE_MAX_PROOFS`).
public let quoteMaxProofs = 10
/// The largest file a proof may be (`VISITOR_UPLOAD_MAX_BYTES`).
public let visitorUploadMaxBytes = 25 * 1024 * 1024

/// A kind of file a proof may be (`VisitorUploadType`).
public struct VisitorUploadType: Equatable, Sendable {
  public let contentType: String
  public let extensions: [String]
  public let label: String
  /// Shown as a picture; everything else downloads.
  public let inline: Bool
  public let aliases: [String]
}

/// Every kind a proof may be (`VISITOR_UPLOAD_TYPES`).
public let visitorUploadTypes: [VisitorUploadType] = [
  VisitorUploadType(contentType: "image/png", extensions: [".png"], label: "PNG", inline: true, aliases: []),
  VisitorUploadType(
    contentType: "image/jpeg", extensions: [".jpg", ".jpeg"], label: "JPEG", inline: true,
    aliases: ["image/jpg", "image/pjpeg"]),
  VisitorUploadType(contentType: "image/webp", extensions: [".webp"], label: "WebP", inline: true, aliases: []),
  VisitorUploadType(contentType: "image/gif", extensions: [".gif"], label: "GIF", inline: true, aliases: []),
  VisitorUploadType(
    contentType: "application/pdf", extensions: [".pdf"], label: "PDF", inline: false, aliases: ["application/x-pdf"]),
  VisitorUploadType(contentType: "image/svg+xml", extensions: [".svg"], label: "SVG", inline: false, aliases: []),
  VisitorUploadType(
    contentType: "application/illustrator", extensions: [".ai"], label: "AI", inline: false,
    aliases: ["application/postscript", "application/pdf", "application/vnd.adobe.illustrator"]),
  VisitorUploadType(
    contentType: "application/postscript", extensions: [".eps"], label: "EPS", inline: false,
    aliases: ["application/eps", "image/eps", "image/x-eps", "application/x-eps"]),
  VisitorUploadType(
    contentType: "image/vnd.adobe.photoshop", extensions: [".psd"], label: "PSD", inline: false,
    aliases: ["application/x-photoshop", "application/photoshop", "application/psd", "image/psd", "image/x-photoshop"]),
  VisitorUploadType(
    contentType: "image/tiff", extensions: [".tif", ".tiff"], label: "TIFF", inline: false, aliases: ["image/x-tiff"]),
]

private let unknownUploadTypes: Set<String> = ["", "application/octet-stream", "binary/octet-stream", "application/unknown"]

/// The kind a stored content type is (`visitorUploadTypeOf`).
public func visitorUploadTypeOf(_ contentType: String) -> VisitorUploadType? {
  visitorUploadTypes.first { $0.contentType == contentType }
}

/// Whether a file is shown as a picture (`visitorUploadIsInline`).
public func visitorUploadIsInline(_ contentType: String) -> Bool { visitorUploadTypeOf(contentType)?.inline == true }

/// The kind a picked file is taken as, by its name and the type the device reported (`resolveVisitorUploadType`).
public func resolveVisitorUploadType(name: String, reportedType: String) -> VisitorUploadType? {
  let dot = name.lastIndex(of: ".")
  let ext = dot.map { $0 > name.startIndex ? String(name[$0...]).lowercased() : "" } ?? ""
  let reported = (reportedType.split(separator: ";").first.map(String.init) ?? "").trimmingCharacters(in: .whitespaces)
    .lowercased()
  guard let byName = visitorUploadTypes.first(where: { $0.extensions.contains(ext) }) else { return nil }
  if unknownUploadTypes.contains(reported) || reported == byName.contentType { return byName }
  return byName.aliases.contains(reported) ? byName : nil
}

/// `340 KB`, `2.5 MB`, `25 MB` (`formatVisitorUploadBytes`).
public func formatVisitorUploadBytes(_ bytes: Int) -> String {
  guard bytes > 0 else { return "0 KB" }
  if bytes < 1024 * 1024 { return "\(max(1, Int((Double(bytes) / 1024 + 0.5).rounded(.down)))) KB" }
  let mb = Double(bytes) / (1024 * 1024)
  if mb >= 10 { return "\(Int((mb + 0.5).rounded(.down))) MB" }
  let tenths = ((mb * 10) + 0.5).rounded(.down) / 10
  return tenths == tenths.rounded() ? "\(Int(tenths)) MB" : "\(tenths) MB"
}

/// What is wrong with one picked file, or nil (`checkVisitorUploadRequest`).
public func checkVisitorUploadRequest(name: String, contentType: String, size: Int) -> String? {
  let shown =
    name.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map { String($0).trimmingCharacters(in: .whitespaces) }
    .flatMap { $0.isEmpty ? nil : $0 } ?? "This file"
  guard resolveVisitorUploadType(name: name, reportedType: contentType) != nil else {
    let labels = visitorUploadTypes.map(\.label)
    return "\(shown) can't be sent. Send a \(labels.dropLast().joined(separator: ", ")) or \(labels.last ?? "") file."
  }
  if size <= 0 { return "\(shown) is empty." }
  if size > visitorUploadMaxBytes {
    return
      "\(shown) is \(formatVisitorUploadBytes(size)). Files can be up to \(formatVisitorUploadBytes(visitorUploadMaxBytes))."
  }
  return nil
}

/// What is wrong with the files picked to add to the `already` there, or nil (`checkVisitorUploadSelection`).
public func checkVisitorUploadSelection(
  _ files: [(name: String, contentType: String, size: Int)], already: Int, maxFiles: Int = quoteMaxProofs
) -> String? {
  if already + files.count > maxFiles { return maxFiles == 1 ? "Send one file." : "Send up to \(maxFiles) files at a time." }
  for file in files {
    if let problem = checkVisitorUploadRequest(name: file.name, contentType: file.contentType, size: file.size) {
      return problem
    }
  }
  return nil
}

/// Whether the customer has answered the current revision (`quoteRevisionAnswered`).
public func quoteRevisionAnswered(_ quote: OrderQuote?) -> Bool { latestQuoteResponse(quote) != nil }

/// Why the proofs can't be added to or removed from now, as the console says it (`quoteProofChangeRefusal` and
/// `quoteProofRefusalMessage`); nil when they can.
public func quoteProofChangeRefusal(_ order: HostOrder?, adding: Bool) -> String? {
  guard let order, order.channel == .quote, let quote = order.quote else { return "Unknown quote" }
  if !isUnpaidQuote(order) { return "This quote has been paid, so its proofs can no longer be changed." }
  if quoteRevisionAnswered(quote) {
    return "The customer has answered this revision. Start a new revision to send different proofs."
  }
  if adding, currentQuoteProofs(quote).count >= quoteMaxProofs {
    return "A revision holds up to \(quoteMaxProofs) proofs. Remove one first."
  }
  return nil
}

/// What is wrong with a media library file chosen for a proof, before it is sent (`quoteLibraryProofProblem`).
public func quoteLibraryProofProblem(fileName: String, contentType: String, mediaID: String, mediaScope: String) -> String? {
  if mediaID.isEmpty || mediaScope.isEmpty { return "That file can’t be used as a proof. Choose another." }
  if !contentType.isEmpty, visitorUploadTypeOf(contentType) == nil {
    return "\(fileName.isEmpty ? "That file" : fileName) can’t be used as a proof. Choose an image or a PDF."
  }
  return nil
}

/// What the Proofs section says the customer sees (the console's QuoteProofsSection).
public func quoteProofsExplanation(_ order: HostOrder?) -> String {
  let quote = order?.quote
  let first =
    quoteIsProofOnly(order)
    ? "The customer sees these on the proof page, with no prices, and can approve them or reject them with changes."
    : quote?.requireProofApproval == true
      ? "The customer sees these on the quote page and approves them before they can pay."
      : "The customer sees these on the quote page, and can approve them or reject them with changes. Paying doesn’t wait on it."
  let signIn =
    quote?.requireProofSignIn == true
    ? " A customer with an account on your site signs in to see them; one without uses the private link." : ""
  return first + " To approve, they tick each statement from your Quotes settings and type their name." + signIn
}

/// What the Proofs section says when the revision has none (the console's QuoteProofsSection).
public func quoteNoProofsMessage(_ order: HostOrder?) -> String {
  quoteIsProofOnly(order)
    ? "No proof on this revision yet, so there is nothing to send. Add one for the customer to approve, or add items to the quote."
    : "No proofs on this revision yet. Add an image, a PDF or a design file for the customer to approve."
}

/// The first line of the customer's answer (the console's QuoteResponseNote). `at` formats a time as the console does.
public func quoteResponseHeadline(_ response: QuoteCustomerResponse, at: (Double) -> String) -> String {
  let name = (response.name ?? "").trimmingCharacters(in: .whitespaces)
  if response.action == .approve { return "Approved by \(name.isEmpty ? "the customer" : name) on \(at(response.atMs))." }
  return "Rejected with changes\(name.isEmpty ? "" : " by \(name)") on \(at(response.atMs)):"
}
