// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// Where a font preview comes from (the fonts plugin's `font-preview-url.ts`, AGL-3656): Google's CSS2 API asked for only the
// letters a preview draws, and the font files that stylesheet names. Replayed from the console's own cases; the shared font
// loader (AglynUI `WebFontLoader`) fetches them. The Kotlin kit's FontPreviewUrl.kt holds the same.

/// The letters one preview may ask for; Google refuses a very long `text=`.
public let fontPreviewMaxLetters = 160

/// `previewLetters`: the distinct letters of a text, in order, whitespace runs read as one space, capped (in UTF-16 units,
/// as the console's string slice counts them).
public func fontPreviewLetters(_ text: String) -> String {
  var collapsed = ""
  var inSpace = false
  for scalar in text.unicodeScalars {
    if CharacterSet.whitespacesAndNewlines.contains(scalar) {
      if !inSpace { collapsed.unicodeScalars.append(" ") }
      inSpace = true
    } else {
      collapsed.unicodeScalars.append(scalar)
      inSpace = false
    }
  }
  var seen = Set<Unicode.Scalar>()
  var letters = String.UnicodeScalarView()
  for scalar in collapsed.unicodeScalars where seen.insert(scalar).inserted { letters.append(scalar) }
  let units = Array(String(letters).utf16.prefix(fontPreviewMaxLetters))
  return String(decoding: units, as: UTF16.self)
}

/// JavaScript's `encodeURIComponent`.
private func uriComponent(_ text: String) -> String {
  let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
  return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
}

/// `previewSheetUrl`: Google's stylesheet URL for some letters of one face of a family.
public func fontPreviewSheetURL(family: String, weight: Int, italic: Bool, text: String) -> String {
  let axis = italic ? "ital,wght@1,\(weight)" : "wght@\(weight)"
  let name = uriComponent(family.trimmingCharacters(in: .whitespacesAndNewlines)).replacingOccurrences(of: "%20", with: "+")
  return "https://fonts.googleapis.com/css2?family=\(name):\(axis)&text=\(uriComponent(fontPreviewLetters(text)))&display=swap"
}

private let fontFileURLPattern = try! NSRegularExpression(
  pattern: #"src:\s*url\((['"]?)(https://fonts\.gstatic\.com/[^)'"]+)\1\)"#)

/// `previewFileUrls`: the file URLs a CSS2 stylesheet names, in order (only Google's own font host).
public func fontPreviewFileURLs(_ css: String) -> [String] {
  let range = NSRange(css.startIndex..., in: css)
  return fontFileURLPattern.matches(in: css, range: range).compactMap { match in
    Range(match.range(at: 2), in: css).map { String(css[$0]) }
  }
}
