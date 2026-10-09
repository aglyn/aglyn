// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation

// A site's own fonts, as the console's font installer keeps them
// (AGL-3656, AGL-3668): each file goes to `/api/fonts/prepare` (license
// check, WOFF2 conversion and subsetting on the server), into the site's
// media library through the library's own upload or replace route, and then
// into the theme through `/api/fonts/theme`, which runs the console's own
// theme functions against the site's resolved theme. Nothing here edits a
// theme itself.

/// The largest font file `/api/fonts/prepare` takes (`FONT_UPLOAD_MAX_BYTES`).
public let fontUploadMaxBytes = 4 * 1024 * 1024

/// The extensions the installer takes (`FONT_UPLOAD_EXTENSIONS`).
public let fontUploadExtensions = ["woff2", "woff", "ttf", "otf"]

/// The content type every installed face is stored and served as.
public let fontStoredContentType = "font/woff2"

/// Whether a picked file is one the installer takes, judged by its name as the chooser's `accept` does.
public func isFontFileName(_ name: String) -> Bool {
  fontUploadExtensions.contains((name as NSString).pathExtension.lowercased())
}

/// A file size as the installer states it (`1.5 MB`).
public func fontFileSize(_ bytes: Int) -> String {
  if bytes < 1024 { return "\(bytes) B" }
  if bytes < 1024 * 1024 { return String(format: "%.0f KB", Double(bytes) / 1024) }
  return String(format: "%.1f MB", Double(bytes) / 1024 / 1024)
}

/// One face the route has read from a file and made ready to store.
public struct PreparedFont: Sendable {
  public let family: String
  public let weight: Int
  public let weightMax: Int?
  public let style: String
  public let category: String
  public let fileName: String
  public let contentHash: String
  public let warnings: [String]
  public let bytesIn: Int
  public let bytesOut: Int
  /// The stored file, converted and subset.
  public let woff2: Data
  /// The facts a theme records, in the shape `/api/fonts/theme` reads.
  let installable: JSONValue

  init?(_ answer: JSONValue?) {
    guard let face = answer?["face"], let family = face["family"]?.stringValue,
      let weight = face["weight"]?.numberValue, let style = face["style"]?.stringValue,
      let base64 = answer?["woff2"]?.stringValue, let data = Data(base64Encoded: base64)
    else { return nil }
    self.family = family
    self.weight = Int(weight)
    weightMax = face["weightMax"]?.numberValue.map(Int.init)
    self.style = style
    category = face["category"]?.stringValue ?? "sans-serif"
    fileName = face["fileName"]?.stringValue ?? "\(family).woff2"
    contentHash = face["contentHash"]?.stringValue ?? ""
    warnings = face["warnings"]?.arrayValue?.compactMap(\.stringValue) ?? []
    bytesIn = Int(face["bytesIn"]?.numberValue ?? 0)
    bytesOut = Int(face["bytesOut"]?.numberValue ?? 0)
    woff2 = data
    var facts: [String: JSONValue] = [:]
    for key in ["family", "weight", "weightMax", "style", "category", "metrics", "unicodeRange"] {
      if let value = face[key] { facts[key] = value }
    }
    installable = .object(facts)
  }

  /// A weight as the installer shows it: `400`, or `100–900` for a variable file.
  public var weightLabel: String { weightMax.map { $0 > weight ? "\(weight)–\($0)" : "\(weight)" } ?? "\(weight)" }
}

/// Where a prepared face goes in the site's media library (`planFontUpload`).
public enum FontUploadPlan: Equatable, Sendable {
  case replace(mediaID: String)
  case upload
}

public enum FontRole: String, Sendable, CaseIterable {
  case body, headings

  public var label: String { self == .body ? "Body text" : "Headings" }
}

/// One stored face of an installed family.
public struct InstalledFace: Equatable, Identifiable, Sendable {
  public var id: String { "\(weight)-\(weightMax ?? 0)-\(style)" }
  public let weight: Int
  public let weightMax: Int?
  public let style: String
  public let label: String
}

/// One installed family, as the installer lists it.
public struct InstalledFont: Equatable, Identifiable, Sendable {
  public var id: String { family }
  public let family: String
  public let category: String?
  public let roles: [FontRole]
  public let faces: [InstalledFace]
}

public func installedFonts(of answer: JSONValue?) -> [InstalledFont] {
  answer?["fonts"]?.arrayValue?.compactMap { row in
    guard let family = row["family"]?.stringValue else { return nil }
    return InstalledFont(
      family: family, category: row["category"]?.stringValue,
      roles: row["roles"]?.arrayValue?.compactMap { $0.stringValue.flatMap(FontRole.init(rawValue:)) } ?? [],
      faces: row["faces"]?.arrayValue?.compactMap { face in
        guard let weight = face["weight"]?.numberValue, let style = face["style"]?.stringValue else { return nil }
        return InstalledFace(
          weight: Int(weight), weightMax: face["weightMax"]?.numberValue.map(Int.init), style: style,
          label: face["label"]?.stringValue ?? "\(Int(weight))")
      } ?? []
    )
  } ?? []
}

/// The installer's calls, each the console's own route.
public struct FontsAPI: Sendable {
  let api: ConsoleAPIClient
  let hostID: String

  public init(api: ConsoleAPIClient, hostID: String) {
    self.api = api
    self.hostID = hostID
  }

  private func theme(_ body: [String: Any?]) async throws -> JSONValue? {
    try await api.request("/api/fonts/theme", method: .post, query: [("hostId", hostID)], body: jsonBody(body))
  }

  /// The families the site has installed.
  public func installed() async throws -> [InstalledFont] { installedFonts(of: try await theme(["op": "list"])) }

  /// Checks the file's embedding license and makes its WOFF2.
  public func prepare(_ file: PickedFile) async throws -> PreparedFont {
    guard isFontFileName(file.name) else {
      throw ConsoleAPIError(status: 0, message: "This is not a font file. Upload a .woff2, .woff, .ttf or .otf file.")
    }
    guard file.size <= fontUploadMaxBytes else {
      throw ConsoleAPIError(status: 413, message: "A font file can be up to \(fontUploadMaxBytes / 1024 / 1024) MB.")
    }
    let answer = try await api.request(
      "/api/fonts/prepare", method: .post, query: [("hostId", hostID)],
      rawBody: (file.data, "application/octet-stream"))
    guard let prepared = PreparedFont(answer) else {
      throw ConsoleAPIError(status: 0, message: "The font could not be checked. Try again.")
    }
    return prepared
  }

  public func plan(_ font: PreparedFont) async throws -> FontUploadPlan {
    let answer = try await theme(["op": "plan", "face": font.installable])
    let plan = answer?["plan"]
    if plan?["mode"]?.stringValue == "replace", let mediaID = plan?["mediaId"]?.stringValue { return .replace(mediaID: mediaID) }
    return .upload
  }

  /// Stores the WOFF2 in the site's media library: over the file the theme's face already points at, else as a new one.
  /// Answers its media id and version, and whether it replaced.
  public func store(_ font: PreparedFont, plan: FontUploadPlan) async throws -> (mediaID: String, version: String, replaced: Bool) {
    var body: [String: Any?] = [
      "hostId": hostID, "fileName": font.fileName, "contentType": fontStoredContentType,
      "data": font.woff2.base64EncodedString(),
    ]
    if case .replace(let mediaID) = plan {
      body["mediaId"] = mediaID
      do {
        let answer = try await api.request("/api/media/replace", method: .post, body: jsonBody(body))
        return (mediaID, answer?["contentHash"]?.stringValue ?? font.contentHash, true)
      } catch let error as ConsoleAPIError where error.status == 404 {
        // The file left the library since: store it anew.
        body["mediaId"] = nil
      }
    }
    let answer = try await api.request("/api/media/upload", method: .post, body: jsonBody(body))
    guard let mediaID = answer?["mediaId"]?.stringValue else {
      throw ConsoleAPIError(status: 0, message: "The font could not be saved to your media library.")
    }
    return (mediaID, font.contentHash, false)
  }

  /// Puts a stored face into the theme.
  public func install(_ font: PreparedFont, mediaID: String, version: String) async throws -> [InstalledFont] {
    installedFonts(of: try await theme(["op": "install", "face": font.installable, "mediaId": mediaID, "version": version]))
  }

  public func setRole(_ family: String, _ role: FontRole) async throws -> [InstalledFont] {
    installedFonts(of: try await theme(["op": "role", "family": family, "role": role.rawValue]))
  }

  public func setCategory(_ family: String, _ category: String) async throws -> [InstalledFont] {
    installedFonts(of: try await theme(["op": "category", "family": family, "category": category]))
  }

  public func remove(face: InstalledFace, of family: String) async throws -> [InstalledFont] {
    var slot: [String: Any?] = ["weight": face.weight, "style": face.style]
    if let max = face.weightMax { slot["weightMax"] = max }
    return installedFonts(of: try await theme(["op": "remove-face", "family": family, "face": slot]))
  }

  public func remove(family: String) async throws -> [InstalledFont] {
    installedFonts(of: try await theme(["op": "remove-family", "family": family]))
  }
}
