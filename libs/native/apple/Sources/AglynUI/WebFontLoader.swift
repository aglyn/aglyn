// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreText
import CryptoKit
import Foundation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// A Google font face drawn in its own letters, as the console's font picker draws each family (the fonts plugin's
/// `loadFontPreview`, AGL-3656): the stylesheet for only the letters asked, from the same Google Fonts source, the file it
/// names fetched on demand and kept in the app's caches, then read as a face of its own. Each subset stays private to its
/// key (never registered with the process), so two subsets of one family, which share a PostScript name, never stand in
/// for each other. Every screen asks this one loader; while a face loads, offline, or when anything fails, the caller draws
/// the system font.
@MainActor
@Observable
public final class WebFontLoader {
  public static let shared = WebFontLoader()

  /// Each face asked so far, once read.
  private var faces: [String: CTFontDescriptor] = [:]
  @ObservationIgnored private var loading: Set<String> = []
  @ObservationIgnored private let session: URLSession
  @ObservationIgnored private let cache: URL

  public init(session: URLSession = .shared, cache: URL? = nil) {
    self.session = session
    self.cache =
      cache
      ?? (FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory)
      .appendingPathComponent("AglynFonts", isDirectory: true)
  }

  /// The key one face of some letters is remembered by.
  public static func key(family: String, weight: Int, italic: Bool, text: String) -> String {
    "\(family.lowercased())|\(weight)|\(italic ? "italic" : "normal")|\(fontPreviewLetters(text))"
  }

  /// `text` drawn in a face of `family`, at the size of an app text style (following the reader's text size), or nil while
  /// it loads or when it cannot (draw the app's own face then). Asking starts the load once; the view is redrawn when it
  /// lands.
  public func font(family: String, weight: Int, italic: Bool = false, text: String, style: AglynTextStyle) -> Font? {
    let key = Self.key(family: family, weight: weight, italic: italic, text: text)
    if let known = faces[key] { return Font(CTFontCreateWithFontDescriptor(known, Self.pointSize(style), nil)) }
    if !loading.contains(key) {
      loading.insert(key)
      Task { await load(key: key, family: family, weight: weight, italic: italic, text: text) }
    }
    return nil
  }

  /// The size an app text style is set at, scaled to the reader's text size as the app's own face is.
  static func pointSize(_ style: AglynTextStyle) -> CGFloat {
    #if canImport(UIKit)
      UIFontMetrics(forTextStyle: uiStyle(style.relativeTo)).scaledValue(for: AglynFont.size(style))
    #else
      AglynFont.size(style)
    #endif
  }

  private func load(key: String, family: String, weight: Int, italic: Bool, text: String) async {
    defer { loading.remove(key) }
    let file = cache.appendingPathComponent(Self.fileName(key))
    var data = try? Data(contentsOf: file)
    if data == nil, let fetched = await fetch(family: family, weight: weight, italic: italic, text: text) {
      try? FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
      try? fetched.write(to: file, options: .atomic)
      data = fetched
    }
    guard let data, let face = Self.read(data) else {
      // A failure is forgotten, so the face is asked again the next time it is drawn.
      return
    }
    faces[key] = face
  }

  private func fetch(family: String, weight: Int, italic: Bool, text: String) async -> Data? {
    guard let sheetURL = URL(string: fontPreviewSheetURL(family: family, weight: weight, italic: italic, text: text)),
      let (css, sheet) = try? await session.data(from: sheetURL),
      (sheet as? HTTPURLResponse)?.statusCode == 200,
      let first = fontPreviewFileURLs(String(decoding: css, as: UTF8.self)).first,
      let fileURL = URL(string: first),
      let (bytes, answer) = try? await session.data(from: fileURL),
      (answer as? HTTPURLResponse)?.statusCode == 200
    else { return nil }
    return bytes
  }

  /// A cache file name for a key: a digest, so a family name or letters never become a path.
  static func fileName(_ key: String) -> String {
    SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined() + ".font"
  }

  /// A font file's face, private to the caller; nil for bytes Core Text cannot read.
  static func read(_ data: Data) -> CTFontDescriptor? {
    CTFontManagerCreateFontDescriptorFromData(data as CFData)
  }
}

#if canImport(UIKit)
  private func uiStyle(_ style: Font.TextStyle) -> UIFont.TextStyle {
    switch style {
    case .largeTitle: .largeTitle
    case .title: .title1
    case .title2: .title2
    case .title3: .title3
    case .headline: .headline
    case .subheadline: .subheadline
    case .callout: .callout
    case .footnote: .footnote
    case .caption: .caption1
    case .caption2: .caption2
    default: .body
    }
  }
#endif
