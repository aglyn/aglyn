// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * PAID MEDIA, AS THE CONSOLE'S PRODUCT EDITOR HAS IT (AGL-2814, AGL-2847).
 *
 * A product's members videos and paid downloads are PRIVATE files: buyers get a link that expires, and the delivery routes
 * refuse a public file. Adding a file makes it private first, and the editor says what that costs: the places that use the
 * file stop showing it. The words, the places that count and the library a media route is asked of are the console's
 * (`model/paid-media.ts`), replayed from function-cases.generated.json.
 */

enum PaidMediaKind {
  case video, download

  var title: String { self == .video ? "Make this video private?" : "Make this file private?" }

  fileprivate var lead: String {
    self == .video
      ? "Members videos are private: buyers play them through a link that expires, and nobody else can open them."
      : "Paid downloads are private: buyers get a link that expires, and nobody else can open the file."
  }

  var notAdded: String { self == .video ? "The video was not added." : "The file was not added." }
  var unusable: String {
    self == .video ? "Members cannot play it until it is private." : "Buyers cannot download it until it is private."
  }
  var choose: String {
    self == .video
      ? "Choose the video from the media library, so its links can expire."
      : "Choose the file from the media library, so its links can expire."
  }
}

/// A where-used row, reduced to what the confirmation reads.
struct PaidMediaReference: Equatable {
  let kind: String
  let id: String
  let name: String
  let hostID: String
  let collectionID: String?
}

/// How far the where-used scan got before the author was asked.
enum PaidMediaUsageCheck { case full, partial, failed }

/// The request body that names an asset's library to the media routes: a workspace library by its org, a site's by itself.
func paidMediaScopeBody(_ scope: String) -> [String: String] {
  guard scope.hasPrefix("org:") else { return ["hostId": scope] }
  let org = scope.dropFirst("org:".count).split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? ""
  return ["orgId": org]
}

/// Where an asset is used, apart from the product it is being added to: that product's own row is not a place making it
/// private could break.
func usesBesideProduct(_ references: [PaidMediaReference], hostID: String, productID: String?) -> [PaidMediaReference] {
  references.filter { reference in
    guard let productID, !productID.isEmpty else { return true }
    return !(reference.kind == "plugin" && reference.collectionID == "products" && reference.hostID == hostID && reference.id == productID)
  }
}

/// What the author reads before a file becomes private.
func paidMediaConfirmation(others: [PaidMediaReference], checked: PaidMediaUsageCheck, kind: PaidMediaKind) -> String {
  let usage: String
  if !others.isEmpty {
    let names = others.prefix(3).map { "“\($0.name)”" }.joined(separator: ", ")
    let more = others.count > 3 ? " and \(others.count - 3) more" : ""
    usage = "It is also used on \(names)\(more), and it stops showing there."
  } else if checked == .full {
    usage = "Nothing else uses it."
  } else if checked == .partial {
    usage = "We could not check everywhere it might be used, so something else could still rely on it."
  } else {
    usage = "We could not check where else it is used."
  }
  return "\(kind.lead) \(usage) Any public link to it that was already shared stops working too."
}

/// What a stored paid-media value names. A reference (`media:`), a CDN path or a Storage download URL of the library names an
/// asset, any other address is somebody else's server, and anything else cannot be delivered. (The console also reads a
/// Cloud Storage object URL and this site's absolute CDN address as an asset; they only come from an import, and show here as
/// hosted elsewhere.)
enum PaidMediaSource: Equatable {
  case asset(scope: String, mediaID: String)
  case external
  case malformed
}

func paidMediaSource(_ stored: String?) -> PaidMediaSource {
  let value = stored?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if value.isEmpty { return .malformed }
  func asset(_ reference: String?) -> PaidMediaSource {
    guard let ref = parseMediaRef(reference) else { return .malformed }
    return .asset(scope: ref.scope, mediaID: ref.mediaId)
  }
  if value.hasPrefix(mediaRefPrefix) { return asset(value) }
  if value.hasPrefix("\(mediaCDNRoute)/") { return asset(mediaRefFromCDNPath(value)) }
  guard value.lowercased().hasPrefix("https://") || value.lowercased().hasPrefix("http://") else { return .malformed }
  if let reference = mediaRefFromStorageURL(value) { return asset(reference) }
  return .external
}

/// The document an asset's reference names, as the path the library keeps it at: `hosts/{host}/media/{id}` or
/// `orgs/{org}/media/{id}`.
func paidMediaDocumentPath(scope: String, mediaID: String) -> [String] {
  if scope.hasPrefix("org:") { return ["orgs", paidMediaScopeBody(scope)["orgId"] ?? "", "media", mediaID] }
  return ["hosts", scope, "media", mediaID]
}
