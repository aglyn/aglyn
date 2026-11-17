// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

// A site's photo links (the console's `PhotoLinkDialog`, AGL-3957): a one-time address the owner opens on a phone to
// send photos into the site's library with no sign-in. `POST /api/media/photo-links` lists the links that still take
// photos, mints one (its address is answered once and never stored) and stops one. A site library only — the
// workspace library takes no phone photos. The Kotlin kit's PhotoLinks.kt.

/// The folder a link's photos land in (`PHOTO_LINK_FOLDER_NAME`).
public let photoLinkFolderName = "From the owner"

/// One link that still takes photos, as the route's `list` answers it.
public struct PhotoLinkRow: Equatable, Identifiable, Sendable {
  public let id: String
  public let createdAt: Date
  public let expiresAt: Date
  public let uploads: Int
  public let remainingUploads: Int

  public init(id: String, createdAt: Date, expiresAt: Date, uploads: Int, remainingUploads: Int) {
    self.id = id
    self.createdAt = createdAt
    self.expiresAt = expiresAt
    self.uploads = uploads
    self.remainingUploads = remainingUploads
  }

  init?(_ json: JSONValue) {
    guard let id = json["linkId"]?.stringValue, !id.isEmpty else { return nil }
    self.init(
      id: id, createdAt: Date(millis: json["createdAt"]?.numberValue), expiresAt: Date(millis: json["expiresAt"]?.numberValue),
      uploads: Int(json["uploads"]?.numberValue ?? 0), remainingUploads: Int(json["remainingUploads"]?.numberValue ?? 0))
  }

  /// "Made Nov 16 · 3 photos received".
  public var title: String { "Made \(photoLinkDay(createdAt)) · \(photoCount(uploads)) received" }
  /// "Works until Nov 23".
  public var until: String { "Works until \(photoLinkDay(expiresAt))" }
}

/// A link just made: the only time its address is known.
public struct FreshPhotoLink: Equatable, Sendable {
  public let id: String
  public let url: String
  public let expiresAt: Date

  public init(id: String, url: String, expiresAt: Date) {
    self.id = id
    self.url = url
    self.expiresAt = expiresAt
  }
}

extension Date {
  fileprivate init(millis: Double?) { self.init(timeIntervalSince1970: (millis ?? 0) / 1000) }
}

/// "1 photo", "40 photos".
public func photoCount(_ count: Int) -> String { "\(count) \(count == 1 ? "photo" : "photos")" }

/// "Nov 16", the console's short date.
public func photoLinkDay(_ date: Date) -> String { date.formatted(.dateTime.month(.abbreviated).day()) }

/// Under a fresh link's code: "Works for 7 days and takes up to 40 photos. Photos land in the folder “From the owner”."
/// The photo count is left out until the list has the link's row.
public func photoLinkCaption(_ fresh: FreshPhotoLink, row: PhotoLinkRow?, now: Date = .now) -> String {
  let days = max(1, Int((fresh.expiresAt.timeIntervalSince(now) / 86_400).rounded()))
  let takes = row.map { " and takes up to \(photoCount($0.remainingUploads))" } ?? ""
  return "Works for \(days) \(days == 1 ? "day" : "days")\(takes). Photos land in the folder “\(photoLinkFolderName)”."
}

/// A refusal of the member themself (signed out, no upload rights, unknown or locked site): no link can be made either,
/// so New link stays off and the message reads as information rather than an error.
public func photoLinksBlocked(status: Int) -> Bool { [401, 403, 404, 423].contains(status) }

public struct PhotoLinksAPI: Sendable {
  let api: ConsoleAPIClient
  let hostID: String

  public init(api: ConsoleAPIClient, hostID: String) {
    self.api = api
    self.hostID = hostID
  }

  private func call(_ fields: [String: Any?]) async throws -> JSONValue? {
    try await api.request("/api/media/photo-links", method: .post, body: jsonBody(["hostId": hostID].merging(fields) { $1 }))
  }

  /// The links that still take photos, newest first.
  public func list() async throws -> [PhotoLinkRow] {
    (try await call(["action": "list"]))?["links"]?.arrayValue?.compactMap(PhotoLinkRow.init) ?? []
  }

  /// Mints a link; its photos are filed in "From the owner", made the first time.
  public func create() async throws -> FreshPhotoLink {
    let answer = try await call(["action": "create"])
    guard let url = answer?["url"]?.stringValue, let id = answer?["linkId"]?.stringValue else {
      throw ConsoleAPIError(status: 0, message: "The link could not be made")
    }
    return FreshPhotoLink(id: id, url: url, expiresAt: Date(millis: answer?["expiresAt"]?.numberValue))
  }

  /// Stops a link at once; the photos it already received stay.
  public func revoke(_ linkID: String) async throws {
    _ = try await call(["action": "revoke", "linkId": linkID])
  }
}

@MainActor
@Observable
final class PhotoLinksModel {
  enum ListState: Equatable {
    case pending
    case ready([PhotoLinkRow])
    case failed(String, blocked: Bool)
  }

  var list: ListState = .pending
  var fresh: FreshPhotoLink?
  /// "create", or the id of the link being stopped.
  var busy: String?
  var notice: String?

  var blocked: Bool {
    if case .failed(_, true) = list { return true }
    return false
  }

  var freshRow: PhotoLinkRow? {
    guard let fresh, case .ready(let rows) = list else { return nil }
    return rows.first { $0.id == fresh.id }
  }

  func refresh(_ api: PhotoLinksAPI) async {
    do {
      list = .ready(try await api.list())
    } catch let error as ConsoleAPIError {
      let blocked = photoLinksBlocked(status: error.status)
      list = .failed(blocked ? error.message : "The photo links could not be loaded.", blocked: blocked)
    } catch {
      list = .failed("The photo links could not be loaded.", blocked: false)
    }
  }

  func create(_ api: PhotoLinksAPI) async {
    busy = "create"
    notice = nil
    defer { busy = nil }
    do {
      fresh = try await api.create()
      await refresh(api)
    } catch {
      notice = (error as? LocalizedError)?.errorDescription ?? "The link could not be made"
    }
  }

  func revoke(_ api: PhotoLinksAPI, _ link: PhotoLinkRow) async {
    busy = link.id
    notice = nil
    defer { busy = nil }
    do {
      try await api.revoke(link.id)
      if fresh?.id == link.id { fresh = nil }
      notice = "Link revoked"
      await refresh(api)
    } catch {
      notice = (error as? LocalizedError)?.errorDescription ?? "The link could not be revoked"
    }
  }
}

/// "Get photos from a phone": a new link's QR code and address, and the links still open with Revoke.
struct PhotoLinksSheet: View {
  let api: PhotoLinksAPI
  let close: () -> Void
  @State private var model = PhotoLinksModel()
  @State private var revoking: PhotoLinkRow?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(
            "The owner scans the code with their phone and picks the photos to send. No sign-in; the photos land in this "
              + "site's media library."
          )
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        if let notice = model.notice {
          AglynNotice(notice, tone: notice == "Link revoked" ? .success : .warning)
        }
        if let fresh = model.fresh {
          Section {
            PhotoLinkCode(url: fresh.url, caption: photoLinkCaption(fresh, row: model.freshRow))
          }
        }
        Section {
          openLinks
        } header: {
          Text("Open links")
        } footer: {
          Text("A link's address is shown only once, when it is made. To share one again, make a new link.")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Get photos from a phone")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close", action: close).disabled(model.busy != nil).accessibilityIdentifier("photo-links-close")
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            Task { await model.create(api) }
          } label: {
            Label(model.busy == "create" ? "Making…" : "New link", systemImage: "qrcode").labelStyle(.titleAndIcon)
          }
          .disabled(model.busy != nil || model.blocked || model.list == .pending)
          .accessibilityIdentifier("photo-links-new")
        }
      }
      .confirmationDialog(
        "Stop this photo link?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
        titleVisibility: .visible, presenting: revoking
      ) { link in
        Button("Revoke", role: .destructive) { Task { await model.revoke(api, link) } }
      } message: { _ in
        Text("The link stops taking photos right away. Photos it already received stay in the library.")
      }
    }
    .interactiveDismissDisabled(model.busy != nil)
    .task { await model.refresh(api) }
  }

  @ViewBuilder
  private var openLinks: some View {
    switch model.list {
    case .pending:
      Text("Checking for open links…").font(AglynFont.subheadline).foregroundStyle(.secondary)
    case .failed(let message, let blocked):
      AglynNotice(message, tone: blocked ? .info : .error)
      if !blocked {
        Button("Retry") { Task { await model.refresh(api) } }.accessibilityIdentifier("photo-links-retry")
      }
    case .ready(let rows) where rows.isEmpty:
      Text("No open links.").font(AglynFont.subheadline).foregroundStyle(.secondary)
    case .ready(let rows):
      ForEach(rows) { link in
        HStack(spacing: AglynSpace.three) {
          VStack(alignment: .leading, spacing: 2) {
            Text(link.title).font(AglynFont.body)
            Text(link.until).font(AglynFont.caption).foregroundStyle(.secondary)
          }
          Spacer(minLength: AglynSpace.two)
          Button("Revoke", role: .destructive) { revoking = link }
            .buttonStyle(.borderless)
            .disabled(model.busy != nil)
            .accessibilityLabel("Revoke the link made \(photoLinkDay(link.createdAt))")
        }
        .accessibilityIdentifier("photo-link-row")
      }
    }
  }
}

/// A link's QR code with its address beside Copy, and what it takes.
struct PhotoLinkCode: View {
  let url: String
  let caption: String
  @State private var copied = false

  var body: some View {
    VStack(spacing: AglynSpace.three) {
      AglynQRCode(url, size: 200, label: "Photo link QR code").frame(maxWidth: .infinity)
      HStack(spacing: AglynSpace.two) {
        Text(url).font(AglynFont.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button {
          AglynPasteboard.copy(url)
          copied = true
        } label: {
          Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("photo-link-copy")
      }
      Text(caption).font(AglynFont.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("photo-link-caption")
    }
    .padding(.vertical, AglynSpace.two)
  }
}
