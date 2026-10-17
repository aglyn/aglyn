// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A printer-neutral document: what a receipt, a test page or a drawer kick IS,
 * laid out in fixed columns, before any printer's bytes. The Kotlin app's
 * `PrintDocument.kt`, line for line. The console's cloud printers render the
 * same operations (`print-document.ts`), so a receipt is laid out once and
 * every printer prints the same lines.
 *
 * Text operations are one printed LINE each and already fit the paper: the
 * layout wraps and pads here, because a thermal printer's own wrapping breaks
 * mid-word and cannot right-align a price.
 */

public enum PrintAlign: Sendable { case left, center, right }

public enum PrintOp: Equatable, Sendable {
  /// `size`: 1 is normal; 2 is double width and height.
  case text(String, align: PrintAlign = .left, bold: Bool = false, size: Int = 1)
  case feed(Int)
  case barcode(String)
  /// The logo stored in the printer's memory.
  case logo
  /// The cash drawer kick (`ESC p`), wired through the printer.
  case drawer
  case cut
}

public struct PrintDocument: Equatable, Sendable {
  /// Characters per line at size 1: 48 on 80 mm paper, 32 on 58 mm.
  public let columns: Int
  public let ops: [PrintOp]

  public init(columns: Int, ops: [PrintOp]) {
    self.columns = columns
    self.ops = ops
  }
}

/// Paper widths in characters at the printers' standard font.
public enum PaperColumns {
  public static let mm80 = 48
  public static let mm58 = 32
}

private let printableSymbols: [Unicode.Scalar: String] = [
  "•": "*", "·": "*", "–": "-", "—": "-", "‘": "'", "’": "'", "“": "\"", "”": "\"", "…": "...", "\u{00A0}": " ",
  "\u{202F}": " ", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR",
]

/// Text as the printer's built-in ASCII font can print it. Accents are folded (`Crème brûlée` → `Creme brulee`), the
/// punctuation a product name or a money format carries is spelled in ASCII, and anything left becomes `?` rather than
/// the mojibake a raw UTF-8 byte prints as on a code-page printer.
public func toPrintable(_ value: String?) -> String {
  var out = ""
  for scalar in (value ?? "").decomposedStringWithCompatibilityMapping.unicodeScalars {
    if (0x0300...0x036F).contains(scalar.value) { continue }
    if (0x20...0x7E).contains(scalar.value) {
      out.unicodeScalars.append(scalar)
    } else if let spelled = printableSymbols[scalar] {
      out += spelled
    } else if scalar.properties.isWhitespace {
      out += " "
    } else {
      // A character outside the font, a surrogate pair included, is one `?` on paper.
      out += "?"
    }
  }
  return out
}

/// Words wrapped to `width`, breaking a word only when it alone is too long.
public func wrapText(_ text: String, width: Int) -> [String] {
  var lines: [String] = []
  var current = ""
  for word in toPrintable(text).split(separator: " ").map(String.init) {
    var rest = Substring(word)
    while rest.count > width {
      if !current.isEmpty {
        lines.append(current)
        current = ""
      }
      lines.append(String(rest.prefix(width)))
      rest = rest.dropFirst(width)
    }
    if rest.isEmpty { continue }
    if current.isEmpty {
      current = String(rest)
    } else if current.count + 1 + rest.count <= width {
      current += " " + rest
    } else {
      lines.append(current)
      current = String(rest)
    }
  }
  if !current.isEmpty { lines.append(current) }
  return lines.isEmpty ? [""] : lines
}

/// A left label and a right amount on one line; a label too long to share the line wraps above, so the amount always
/// lands flush right.
public func twoColumnLines(_ left: String, _ right: String, width: Int) -> [String] {
  let amount = toPrintable(right)
  let room = max(1, width - amount.count - 1)
  var wrapped = wrapText(left, width: room)
  let last = wrapped.removeLast()
  return wrapped + [last + String(repeating: " ", count: max(1, width - last.count - amount.count)) + amount]
}

/// Code128 code set B carries printable ASCII, and a scanner reads a short symbol more reliably than a long one: the
/// data reduced to those characters and capped at 20.
public func code128Printable(_ value: String?) -> String {
  String(toPrintable(value).filter { ("!"..."~").contains($0) }.prefix(20))
}

/// A drawer kick with nothing printed: a paid-out, a cash refund, "Open drawer".
public func drawerKickDocument(columns: Int = PaperColumns.mm80) -> PrintDocument {
  PrintDocument(columns: columns, ops: [.drawer])
}

/// One line of a receipt preview: its text padded to the width it prints at, and whether it prints double size
/// (half as many characters, each twice as wide) or bold.
public struct PrintPreviewLine: Equatable, Sendable {
  public let text: String
  public let double: Bool
  public let bold: Bool
}

/// A document as the register's preview draws it: `renderText`'s lines, with a double-size line laid out over half
/// the columns, so drawn at twice the size it spans the paper (TOTAL right-aligned, as printed).
public func renderPreviewLines(_ document: PrintDocument) -> [PrintPreviewLine] {
  var out: [PrintPreviewLine] = []
  for op in document.ops {
    if case .text(let value, let align, let bold, let size) = op {
      let double = size >= 2
      let columns = double ? max(1, document.columns / 2) : document.columns
      let line = renderText(PrintDocument(columns: columns, ops: [.text(value, align: align, bold: bold, size: 1)]))
      out.append(PrintPreviewLine(text: String(line.dropLast()), double: double, bold: bold))
    } else {
      for line in renderText(PrintDocument(columns: document.columns, ops: [op])).dropLast().split(separator: "\n", omittingEmptySubsequences: false) {
        out.append(PrintPreviewLine(text: String(line), double: false, bold: false))
      }
    }
  }
  return out
}

/// A document as plain text: what the register shows as the receipt preview and what a spec reads a layout by. Size
/// and emphasis do not exist in plain text; alignment is padding; a barcode prints its data between brackets; a drawer
/// kick and a cut print nothing.
public func renderText(_ document: PrintDocument) -> String {
  let columns = document.columns
  var lines: [String] = []
  for op in document.ops {
    switch op {
    case .text(let value, let align, _, _):
      let text = String(toPrintable(value).prefix(columns))
      let gap = columns - text.count
      switch align {
      case .center:
        var padded = String(repeating: " ", count: gap / 2) + text
        while padded.hasSuffix(" ") { padded.removeLast() }
        lines.append(padded)
      case .right: lines.append(String(repeating: " ", count: gap) + text)
      case .left: lines.append(text)
      }
    case .feed(let count): lines.append(contentsOf: Array(repeating: "", count: max(0, count)))
    case .barcode(let data):
      let text = "[\(toPrintable(data))]"
      lines.append(String(repeating: " ", count: max(0, (columns - text.count) / 2)) + text)
    case .logo, .drawer, .cut: break
    }
  }
  return lines.joined(separator: "\n") + "\n"
}
