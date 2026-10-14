// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// How a picked library file is stored on a page, and how a stored value is
// shown, ported once from libs/aglyn/src/lib/app-utils/media-ref.ts
// (`mediaNodeSrc`, `resolveMediaSrc` and what they read), scope-tokens.ts
// (`hostQualifiedCdnPath`) and media-metadata.ts (`inheritedMediaAlt`).
// function-cases.generated.json holds the answers the TypeScript gives, and
// the tests replay every one.
//
// A reference names an ASSET, not a file: `media:{scope}/{mediaId}`, so a
// replace or a move never breaks what holds it. The Storage-emulator host and
// the content-version query the console also reads are left out; no app runs
// against the one or stores the other.

public let mediaRefPrefix = "media:"
public let mediaCDNRoute = "/api/media/cdn"

private let orgScopePrefix = "org:"
private let hashSeparator: Character = "@"
private let posterObjectSuffix = "__poster"
private let storageDownloadHost = "firebasestorage.googleapis.com"

/// A parsed `media:` reference.
public struct MediaRef: Equatable, Sendable {
  public let scope: String
  public let mediaId: String
  public let contentHash: String?

  public init(scope: String, mediaId: String, contentHash: String? = nil) {
    self.scope = scope
    self.mediaId = mediaId
    self.contentHash = contentHash
  }
}

/// A host id, an org id, a media id or a content hash: one path segment of the CDN route.
private func isSegment(_ text: String) -> Bool {
  let scalars = text.unicodeScalars
  guard (1...64).contains(scalars.count) else { return false }
  return scalars.allSatisfy { scalar in
    (scalar.value < 128) && (CharacterSet.alphanumerics.contains(scalar) || scalar == "_" || scalar == "-")
  }
}

/// `{hostId}`, `org:{orgId}` or `org:{orgId}:{hostId}`.
public func isMediaCDNScope(_ scope: String) -> Bool {
  guard scope.hasPrefix(orgScopePrefix) else { return isSegment(scope) }
  let parts = scope.dropFirst(orgScopePrefix.count).split(separator: ":", omittingEmptySubsequences: false)
  guard (1...2).contains(parts.count) else { return false }
  return parts.allSatisfy { isSegment(String($0)) }
}

/// The reference for an asset, or nil when the scope or id does not fit the grammar.
public func formatMediaRef(scope: String?, mediaId: String?, contentHash: String? = nil) -> String? {
  guard let scope, !scope.isEmpty, let mediaId, !mediaId.isEmpty else { return nil }
  guard isMediaCDNScope(scope), isSegment(mediaId) else { return nil }
  let pin = contentHash.flatMap { !$0.isEmpty && isSegment($0) ? "\(hashSeparator)\($0)" : nil } ?? ""
  return "\(mediaRefPrefix)\(scope)/\(mediaId)\(pin)"
}

public func isMediaRef(_ value: String?) -> Bool { value?.hasPrefix(mediaRefPrefix) == true }

/// What a reference names; a malformed pin loses the pin, never the reference.
public func parseMediaRef(_ value: String?) -> MediaRef? {
  guard let value, isMediaRef(value) else { return nil }
  let rest = value.dropFirst(mediaRefPrefix.count)
  guard let slash = rest.firstIndex(of: "/"), slash != rest.startIndex else { return nil }
  let scope = String(rest[..<slash])
  let tail = rest[rest.index(after: slash)...]
  let at = tail.firstIndex(of: hashSeparator)
  let mediaId = at.map { String(tail[..<$0]) } ?? String(tail)
  let hash = at.map { String(tail[tail.index(after: $0)...]) }
  guard isMediaCDNScope(scope), isSegment(mediaId) else { return nil }
  if let hash, !isSegment(hash) { return MediaRef(scope: scope, mediaId: mediaId) }
  return MediaRef(scope: scope, mediaId: mediaId, contentHash: hash)
}

/// The reference a stored CDN path (`/api/media/cdn/{scope}/{id}`) names.
public func mediaRefFromCDNPath(_ cdnPath: String?) -> String? {
  guard let cdnPath, !cdnPath.isEmpty else { return nil }
  let marker = "\(mediaCDNRoute)/"
  guard let range = cdnPath.range(of: marker) else { return nil }
  let parts = cdnPath[range.upperBound...].split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  return formatMediaRef(scope: parts.first, mediaId: parts.count > 1 ? parts[1] : nil)
}

/// The asset a Storage object key (`hosts/{h}/media/{id}`, `orgs/{o}/media/{id}`) holds.
private func mediaAssetOfObjectKey(_ objectPath: String) -> (scope: String, mediaId: String)? {
  let segments = objectPath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  guard segments.count >= 4, segments[2] == "media" else { return nil }
  guard !segments.contains(where: { $0.isEmpty || $0 == ".." }) else { return nil }
  let scope: String
  switch segments[0] {
  case "hosts": scope = segments[1]
  case "orgs": scope = "\(orgScopePrefix)\(segments[1])"
  default: return nil
  }
  guard let leaf = segments.last, !leaf.hasSuffix(posterObjectSuffix) else { return nil }
  guard let ref = parseMediaRef("\(mediaRefPrefix)\(scope)/\(leaf)") else { return nil }
  return (ref.scope, ref.mediaId)
}

/// The reference a Firebase Storage download URL names, for a file uploaded before every plan had the CDN.
public func mediaRefFromStorageURL(_ value: String?) -> String? {
  guard let value, value.contains("/v0/b/") else { return nil }
  guard let scheme = value.range(of: "^[A-Za-z][A-Za-z0-9+.-]*://", options: .regularExpression) else { return nil }
  let afterScheme = value[scheme.upperBound...]
  let authorityEnd = afterScheme.firstIndex(where: { "/?#".contains($0) }) ?? afterScheme.endIndex
  let authority = afterScheme[..<authorityEnd].split(separator: "@", omittingEmptySubsequences: false).last.map(String.init) ?? ""
  let host = (authority.split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? "").lowercased()
  guard host == storageDownloadHost else { return nil }
  let pathEnd = afterScheme[authorityEnd...].firstIndex(where: { "?#".contains($0) }) ?? afterScheme.endIndex
  let path = String(afterScheme[authorityEnd..<pathEnd])
  guard let match = path.range(of: "^/v0/b/[^/]+/o/([^/]+)$", options: .regularExpression) else { return nil }
  let key = String(path[match].split(separator: "/", omittingEmptySubsequences: false).last ?? "")
  guard let decoded = key.removingPercentEncoding, let asset = mediaAssetOfObjectKey(decoded) else { return nil }
  return formatMediaRef(scope: asset.scope, mediaId: asset.mediaId)
}

/// What the media picker writes into a field: the asset's reference, from its
/// CDN path; a file with no CDN path that is not private has it read off its
/// Storage URL; anything else keeps the URL it has.
public func mediaNodeSrc(url: String?, cdnPath: String?, isPrivate: Bool?) -> String? {
  mediaRefFromCDNPath(cdnPath) ?? (isPrivate == true ? nil : mediaRefFromStorageURL(url)) ?? url
}

/// `org:{orgId}` becomes `org:{orgId}:{hostId}` when the site using it is known; anything else stays.
public func hostQualifiedScope(_ scope: String, hostID: String?) -> String {
  guard let hostID, !hostID.isEmpty, isSegment(hostID), scope.hasPrefix(orgScopePrefix) else { return scope }
  let orgID = scope.dropFirst(orgScopePrefix.count).split(separator: ":", omittingEmptySubsequences: false).first.map(String.init) ?? ""
  guard !orgID.isEmpty, isSegment(orgID) else { return scope }
  return "\(orgScopePrefix)\(orgID):\(hostID)"
}

/// Where a stored value is served from: a reference (or a Storage URL that
/// names an asset) becomes the CDN path, qualified for the site being shown;
/// any other value is returned as stored. Nil for nothing, or a reference that
/// does not parse.
public func resolveMediaSrc(_ value: String?, hostID: String? = nil) -> String? {
  guard let value, !value.isEmpty else { return nil }
  guard let stored = isMediaRef(value) ? value : mediaRefFromStorageURL(value) else { return value }
  guard let ref = parseMediaRef(stored) else { return nil }
  return "\(mediaCDNRoute)/\(hostQualifiedScope(ref.scope, hostID: hostID))/\(ref.mediaId)"
}

/// The poster frame a film's reference can be asked for, or nil when the value
/// is not served by this platform's CDN. Asking is not a promise one exists:
/// only a film whose document records a captured `poster` has one.
public func mediaPosterSrc(_ value: String?, hostID: String? = nil, width: Double? = nil) -> String? {
  guard let src = resolveMediaSrc(value, hostID: hostID), src.hasPrefix("\(mediaCDNRoute)/") else { return nil }
  var query = "poster=1"
  if let width, width.isFinite, width > 0 { query += "&w=\(Int64((width + 0.5).rounded(.down)))" }
  return src + (src.contains("?") ? "&" : "?") + query
}

/// An org asset's CDN path rewritten to name the site using it, but only for
/// an asset restricted to some sites; an org-wide asset, a site's own file and
/// a path already naming a site are returned untouched.
public func hostQualifiedCDNPath(_ cdnPath: String?, visibleTo: [String]?, hostID: String?) -> String? {
  guard let cdnPath, !cdnPath.isEmpty else { return cdnPath }
  guard let hostID, !hostID.isEmpty, !(visibleTo?.contains("org") ?? false) else { return cdnPath }
  let marker = "\(mediaCDNRoute)/"
  guard let range = cdnPath.range(of: marker) else { return cdnPath }
  let head = String(cdnPath[..<range.upperBound])
  let parts = cdnPath[range.upperBound...].split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  guard let scope = parts.first, scope.hasPrefix(orgScopePrefix), !scope.dropFirst(orgScopePrefix.count).contains(":") else {
    return cdnPath
  }
  return ([head + scope + ":" + hostID] + parts.dropFirst()).joined(separator: "/")
}

/// The alt text a placement takes from the picked file: the file's own, when
/// the placement has none of its own and is not decorative; nothing otherwise.
/// Never invented, and capped at the length the library saves.
public func inheritedMediaAlt(placementAlt: String?, assetAlt: String?, decorative: Bool = false) -> String? {
  if decorative { return nil }
  if let placementAlt, !placementAlt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
  let inherited = assetAlt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if inherited.isEmpty { return nil }
  return String(inherited.prefix(ContractValues.shared.mediaAltMaxLength))
}

private let videoMaxDurationMS = 24.0 * 60 * 60 * 1000
private let videoMaxDimension = 16384.0

/// How long a library film runs, in whole seconds, from its document's
/// measured `video` record (`durationMs`, `width`, `height`: all three or
/// none), or nil when it records none. Never rounds to zero: a sub-second clip
/// is still a clip (`videoMediaProps`).
public func libraryVideoSeconds(_ video: Any?) -> Int? {
  guard let record = video as? [String: Any] else { return nil }
  func whole(_ key: String) -> Double? {
    let number: Double?
    switch record[key] {
    case let value as NSNumber: number = value.doubleValue
    case let text as String: number = Double(text.trimmingCharacters(in: .whitespacesAndNewlines))
    default: number = nil
    }
    guard let number, number.isFinite else { return nil }
    // JavaScript's Math.round: halves go toward positive infinity.
    return (number + 0.5).rounded(.down)
  }
  guard let duration = whole("durationMs"), let width = whole("width"), let height = whole("height") else { return nil }
  guard duration > 0, duration <= videoMaxDurationMS else { return nil }
  guard width > 0, width <= videoMaxDimension, height > 0, height <= videoMaxDimension else { return nil }
  return max(1, Int((duration / 1000 + 0.5).rounded(.down)))
}

private let downloadQuery = try! NSRegularExpression(pattern: "[?&]download=1(?:&|$)")

/// The URL of an asset's ORIGINAL bytes: the CDN url with `?download=1`, or the url unchanged when it is not a CDN one.
/// The bare CDN url is an upright, stripped display copy; the image editor's "Replace original" must start from the file itself
/// (`mediaOriginalSrc`).
public func mediaOriginalSrc(_ src: String) -> String {
  let whole = NSRange(src.startIndex..., in: src)
  guard src.contains("\(mediaCDNRoute)/"), downloadQuery.firstMatch(in: src, range: whole) == nil else { return src }
  return src + (src.contains("?") ? "&" : "?") + "download=1"
}
