// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// A sent email's HTML, drawn natively (the `html` block): cleaned down to what is read, then turned into styled text
/// by the platform's own HTML importer, with its links opening in the system handler. The console shows the same
/// message in a frame with an empty sandbox (no scripts, no forms); nothing here can run a script or fetch an image.
public enum EmailHTML {
  /// Elements whose content is not for reading, dropped with it.
  private static let droppedWithContent = [
    "head", "script", "style", "noscript", "template", "iframe", "object", "embed", "applet", "svg", "math", "video", "audio",
    "canvas", "title", "map", "select", "textarea",
  ]
  /// Tags that stay as they are (a link keeps only an address it may open).
  private static let kept: Set<String> = [
    "a", "b", "strong", "i", "em", "u", "s", "strike", "del", "br", "p", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol",
    "li", "blockquote", "pre", "code", "hr", "sub", "sup", "small", "big", "div",
  ]
  /// Layout tags that become a block of their own: a table is read cell by cell, top to bottom.
  private static let blocks: Set<String> = [
    "td", "th", "center", "section", "article", "header", "footer", "main", "aside", "nav", "form", "figure", "figcaption",
    "address", "fieldset", "dl", "dt", "dd",
  ]
  /// What a link may open.
  private static let schemes = ["http://", "https://", "mailto:", "tel:"]

  private static func regex(_ pattern: String) -> NSRegularExpression {
    // The patterns are literals in this file.
    // swiftlint:disable:next force_try
    try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
  }

  private static func replacing(_ pattern: String, in text: String, with template: String = "") -> String {
    let expression = regex(pattern)
    return expression.stringByReplacingMatches(
      in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
  }

  /// The address an `href` names, if it is one a link may open: whitespace and control characters taken out and numeric
  /// entities decoded first, so `java&#115;cript:` is not read as anything else.
  static func openableAddress(_ raw: String) -> String? {
    var decoded = raw
    for match in regex("&#(x[0-9a-f]+|[0-9]+);?").matches(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)).reversed() {
      guard let whole = Range(match.range, in: decoded), let digits = Range(match.range(at: 1), in: decoded) else { continue }
      let body = decoded[digits]
      let value = body.lowercased().hasPrefix("x") ? UInt32(body.dropFirst(), radix: 16) : UInt32(body, radix: 10)
      decoded.replaceSubrange(whole, with: value.flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? "")
    }
    decoded = decoded.replacingOccurrences(of: "&colon;", with: ":", options: .caseInsensitive)
    let skipped = CharacterSet.whitespacesAndNewlines.union(.controlCharacters)
    let lowered = String(decoded.unicodeScalars.filter { !skipped.contains($0) }).lowercased()
    guard schemes.contains(where: { lowered.hasPrefix($0) }) else { return nil }
    return raw.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// Whether a link found in the result may be opened.
  public static func isOpenable(_ url: URL) -> Bool {
    let scheme = (url.scheme ?? "").lowercased()
    return ["http", "https", "mailto", "tel"].contains(scheme)
  }

  private static func attribute(named name: String, in attributes: String) -> String? {
    let pattern = "(?:^|\\s)\(name)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))"
    let expression = regex(pattern)
    guard let match = expression.firstMatch(in: attributes, range: NSRange(attributes.startIndex..., in: attributes)) else { return nil }
    for group in 2...4 {
      if let range = Range(match.range(at: group), in: attributes) { return String(attributes[range]) }
    }
    return nil
  }

  /// The message with everything that is not reading taken out: scripts, styles, frames and forms with their content,
  /// every attribute but a link's address, comments, and any tag outside the short list above. An image becomes its
  /// alternative text, so nothing is fetched.
  public static func sanitize(_ html: String) -> String {
    var text = html
    text = replacing("<!--[\\s\\S]*?-->", in: text)
    text = replacing("<![A-Za-z][^>]*>", in: text)
    text = replacing("<\\?[\\s\\S]*?\\?>", in: text)
    for tag in droppedWithContent {
      text = replacing("<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)\\s*>", in: text)
    }
    let tag = regex("<(/?)([A-Za-z][A-Za-z0-9]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>")
    var out = ""
    var cursor = text.startIndex
    // Each open link: true when it keeps its address, false when it is read as the text it wraps.
    var anchors: [Bool] = []
    for match in tag.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let whole = Range(match.range, in: text), let closing = Range(match.range(at: 1), in: text),
        let nameRange = Range(match.range(at: 2), in: text), let attributesRange = Range(match.range(at: 3), in: text)
      else { continue }
      out += text[cursor..<whole.lowerBound]
      cursor = whole.upperBound
      let name = text[nameRange].lowercased()
      let isClosing = !text[closing].isEmpty
      let attributes = String(text[attributesRange])
      if name == "img" {
        if let alt = attribute(named: "alt", in: attributes)?.trimmingCharacters(in: .whitespacesAndNewlines), !alt.isEmpty { out += alt }
      } else if name == "a" {
        if isClosing {
          if let real = anchors.popLast() { out += real ? "</a>" : "</span>" }
        } else if let href = attribute(named: "href", in: attributes), let address = openableAddress(href) {
          anchors.append(true)
          out += "<a href=\"\(address.replacingOccurrences(of: "\"", with: "&quot;"))\">"
        } else {
          anchors.append(false)
          out += "<span>"
        }
      } else if kept.contains(name) {
        out += isClosing ? "</\(name)>" : "<\(name)>"
      } else if blocks.contains(name) {
        out += isClosing ? "</div>" : "<div>"
      }
    }
    out += text[cursor...]
    return out
  }

  /// The plain words of cleaned HTML, for a message the importer cannot read.
  static func plainText(_ html: String) -> String {
    var text = replacing("<(br|/p|/div|/li|/h[1-6])\\b[^>]*>", in: html, with: "\n")
    text = replacing("<[^>]+>", in: text)
    return text.replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&amp;", with: "&")
  }

  /// The message as styled text: bold, italic, underline and links kept, colors and sizes left to the app so the text
  /// reads in dark mode as in light.
  @MainActor
  public static func attributed(_ html: String) -> AttributedString {
    let clean = sanitize(html)
    guard
      let data = clean.data(using: .utf8),
      let imported = try? NSAttributedString(
        data: data,
        options: [
          .documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue,
        ], documentAttributes: nil)
    else { return AttributedString(plainText(clean)) }
    var result = AttributedString()
    imported.enumerateAttributes(in: NSRange(location: 0, length: imported.length)) { attributes, range, _ in
      var piece = AttributedString(imported.attributedSubstring(from: range).string)
      if let link = attributes[.link] {
        let url = (link as? URL) ?? (link as? String).flatMap(URL.init(string:))
        if let url, isOpenable(url) {
          piece.link = url
          piece.underlineStyle = .single
        }
      }
      #if canImport(UIKit)
        if let font = attributes[.font] as? UIFont {
          let traits = font.fontDescriptor.symbolicTraits
          var intent: InlinePresentationIntent = []
          if traits.contains(.traitBold) { intent.insert(.stronglyEmphasized) }
          if traits.contains(.traitItalic) { intent.insert(.emphasized) }
          if traits.contains(.traitMonoSpace) { intent.insert(.code) }
          if !intent.isEmpty { piece.inlinePresentationIntent = intent }
        }
      #elseif canImport(AppKit)
        if let font = attributes[.font] as? NSFont {
          let traits = font.fontDescriptor.symbolicTraits
          var intent: InlinePresentationIntent = []
          if traits.contains(.bold) { intent.insert(.stronglyEmphasized) }
          if traits.contains(.italic) { intent.insert(.emphasized) }
          if traits.contains(.monoSpace) { intent.insert(.code) }
          if !intent.isEmpty { piece.inlinePresentationIntent = intent }
        }
      #endif
      if let underline = attributes[.underlineStyle] as? Int, underline != 0 { piece.underlineStyle = .single }
      if let strike = attributes[.strikethroughStyle] as? Int, strike != 0 { piece.strikethroughStyle = .single }
      result.append(piece)
    }
    return trimmed(result)
  }

  /// Leading and trailing white space taken off.
  static func trimmed(_ text: AttributedString) -> AttributedString {
    let characters = text.characters
    var start = characters.startIndex
    while start < characters.endIndex, characters[start].isWhitespace { start = characters.index(after: start) }
    var end = characters.endIndex
    while end > start, characters[characters.index(before: end)].isWhitespace { end = characters.index(before: end) }
    return AttributedString(text[start..<end])
  }
}
