// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * A PRODUCT'S IMAGES AND DIGITAL DELIVERY, FROM THE AGLYN APP (AGL-3651).
 *
 * The console's product editor keeps a product's pictures (`mediaUrls`, the first is the main one), and for a digital
 * product its paid downloads (`digitalFiles`), their download limit and its members videos (`gatedVideos`). A picture is
 * any library file; a download or a video is a PRIVATE one (PaidMedia.swift). Like every product write here, a change sends
 * the whole stored product with the one list changed, so nothing the app does not show is lost.
 */

/// A file a buyer downloads.
struct DigitalFileEntry: Equatable, Identifiable {
  let id: Int
  let url: String
  let fileName: String
  let version: String
}

/// A members-only film.
struct MembersVideoEntry: Equatable, Identifiable {
  let id: Int
  let url: String
  let title: String
}

/// What a product's media and delivery lists hold, read from the stored product.
struct ProductMediaDraft: Equatable {
  var type: String
  var images: [String]
  var files: [DigitalFileEntry]
  var videos: [MembersVideoEntry]
  var downloadLimit: Int?

  init(_ stored: [String: JSONValue]) {
    type = stored["type"]?.stringValue ?? "physical"
    images = (stored["mediaUrls"]?.arrayValue ?? []).compactMap(\.stringValue)
    files = (stored["digitalFiles"]?.arrayValue ?? []).enumerated().compactMap { index, entry in
      guard let url = entry["url"]?.stringValue else { return nil }
      return DigitalFileEntry(id: index, url: url, fileName: entry["fileName"]?.stringValue ?? "download", version: entry["version"]?.stringValue ?? "")
    }
    videos = (stored["gatedVideos"]?.arrayValue ?? []).enumerated().compactMap { index, entry in
      guard let url = entry["url"]?.stringValue else { return nil }
      return MembersVideoEntry(id: index, url: url, title: entry["title"]?.stringValue ?? "")
    }
    downloadLimit = stored["downloadLimit"]?.numberValue.map { Int($0) }
  }

  var isDigital: Bool { type == "digital" }
}

enum ProductMediaEdit: Equatable {
  case addImages([String])
  case removeImage(Int)
  case addFile(url: String, fileName: String)
  case setVersion(Int, String)
  case removeFile(Int)
  case addVideo(url: String, title: String)
  case removeVideo(Int)
  /// Attempts per order; nil is unlimited.
  case setDownloadLimit(Int?)
}

/// The product a save sends: the stored product with one list changed, as the console's editor changes it. A file's other keys
/// stay as they are; a version is cut to 20 characters; a download limit is at least one.
func productMediaSaveJSON(_ stored: [String: Any], _ edit: ProductMediaEdit) -> JSONValue {
  var product = storedProductJSON(stored)
  func list(_ key: String) -> [JSONValue] { product[key]?.arrayValue ?? [] }
  func without(_ key: String, _ index: Int) {
    var items = list(key)
    if items.indices.contains(index) { items.remove(at: index) }
    product[key] = .array(items)
  }
  switch edit {
  case .addImages(let references):
    product["mediaUrls"] = .array(list("mediaUrls") + references.map { .string($0) })
  case .removeImage(let index):
    without("mediaUrls", index)
  case .addFile(let url, let fileName):
    product["digitalFiles"] = .array(list("digitalFiles") + [.object(["url": .string(url), "fileName": .string(fileName)])])
  case .setVersion(let index, let version):
    var items = list("digitalFiles")
    if items.indices.contains(index), case .object(var file) = items[index] {
      file["version"] = .string(String(version.prefix(20)))
      items[index] = .object(file)
    }
    product["digitalFiles"] = .array(items)
  case .removeFile(let index):
    without("digitalFiles", index)
  case .addVideo(let url, let title):
    product["gatedVideos"] = .array(list("gatedVideos") + [.object(["url": .string(url), "title": .string(title)])])
  case .removeVideo(let index):
    without("gatedVideos", index)
  case .setDownloadLimit(let limit):
    if let limit { product["downloadLimit"] = .number(Double(max(1, limit))) } else { product.removeValue(forKey: "downloadLimit") }
  }
  return .object(product)
}

/// A download limit typed in the field: blank is none, a number is at least one, anything else is not a limit.
func downloadLimitFromText(_ text: String) -> Int?? {
  let raw = text.trimmingCharacters(in: .whitespaces)
  if raw.isEmpty { return .some(nil) }
  guard let number = Double(raw), number.isFinite else { return nil }
  return .some(max(1, Int(number.rounded())))
}

/// One product's media and delivery lists, live, and the saves that change them.
@MainActor
@Observable
final class ProductMediaModel {
  private(set) var doc: FirestoreDocument?
  private(set) var ready = false
  private(set) var failed = false
  var busy = false
  /// What the last save or upload said when it did not go through, or a note the person should read.
  var message: String?
  @ObservationIgnored private var listener: FirestoreListening?

  var draft: ProductMediaDraft { ProductMediaDraft(doc.map { storedProductJSON($0.data) } ?? [:]) }
  var productName: String { doc?.string("name") ?? "Product" }

  func start(_ reader: FirestoreReader, hostID: String?, productID: String) {
    listener?.remove()
    ready = false
    guard let hostID, !productID.isEmpty else {
      ready = true
      return
    }
    listener = reader.listenDocument(productsPath(hostID) + [productID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc): self.doc = doc
      case .failure: self.failed = true
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  /// Sends the stored product with `edit` applied; false (and `message`) when it did not go.
  @discardableResult
  func apply(_ edit: ProductMediaEdit, api: ProductWriteAPI, hostID: String, productID: String) async -> Bool {
    guard let doc else { return false }
    busy = true
    defer { busy = false }
    do {
      try await api.save(
        hostID: hostID, productID: productID, create: false, product: productMediaSaveJSON(doc.data, edit),
        attemptKey: UUID().uuidString)
      message = nil
      return true
    } catch {
      message = productWriteProblem(error).errorDescription
      return false
    }
  }
}

/// Whether one stored paid file can be delivered, read off its media document (the console's `PaidMediaProtection`).
@MainActor
@Observable
final class PaidMediaStatus {
  enum State: Equatable { case checking, privateFile, publicFile, missing, unknown, external, malformed }

  private(set) var state: State = .checking
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, value: String) {
    listener?.remove()
    switch paidMediaSource(value) {
    case .external:
      state = .external
    case .malformed:
      state = .malformed
    case .asset(let scope, let mediaID):
      state = .checking
      listener = reader.listenDocument(paidMediaDocumentPath(scope: scope, mediaID: mediaID)) { [weak self] result in
        guard let self else { return }
        switch result {
        case .success(let doc):
          if let doc, doc.data["deletedAt"] == nil || doc.data["deletedAt"] is NSNull {
            self.state = doc.bool("private") == true ? .privateFile : .publicFile
          } else {
            self.state = .missing
          }
        case .failure: self.state = .unknown
        }
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// A question put to the person before a file is made private; the sheet answers it.
struct PaidMediaQuestion: Identifiable {
  let id = UUID()
  let title: String
  let message: String
}
