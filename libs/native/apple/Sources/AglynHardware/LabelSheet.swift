// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import Foundation

/*
 * PRODUCT LABELS, DRAWN HERE. The console prints its label sheet as a page of
 * markup (`productLabelsHtml` in the commerce plugin's
 * `printing/product-labels.ts`): one label per page, the page sized to the
 * label, the name, the options, the price, the barcode's bars and its digits.
 * The apps draw the same label on the print sheet's own pages, with the same
 * measurements, so a label printer prints it at 100% scale as it prints the
 * console's. The Kotlin kit's `LabelSheet.kt` draws it the same way.
 */

/// One label: what the console's label page prints for a variant.
public struct PrintLabel: Equatable, Sendable {
  public var name: String
  /// A variant's options, e.g. `Large / Blue`.
  public var detail: String?
  /// The price line, already formatted.
  public var price: String?
  /// The barcode as modules, `1` a bar and `0` a space, without its quiet zone.
  public var bars: String?
  /// What is printed under the bars.
  public var code: String?

  public init(name: String, detail: String? = nil, price: String? = nil, bars: String? = nil, code: String? = nil) {
    self.name = name
    self.detail = detail
    self.price = price
    self.bars = bars
    self.code = code
  }
}

/// Labels of one size, one label to a page; each copy is its own page.
public struct LabelSheet: Equatable, Sendable {
  public var widthPoints: Double
  public var heightPoints: Double
  public var labels: [PrintLabel]

  public init(widthPoints: Double, heightPoints: Double, labels: [PrintLabel]) {
    self.widthPoints = widthPoints
    self.heightPoints = heightPoints
    self.labels = labels
  }

  public var pageSize: CGSize { CGSize(width: widthPoints, height: heightPoints) }
}

/// The label page's measurements, in points: the console's CSS for `.label` and its parts.
public enum LabelMetrics {
  /// `padding: 0.06in 0.08in`.
  public static let paddingY = 0.06 * 72
  public static let paddingX = 0.08 * 72
  /// `.name`: 9pt bold, line-height 1.1, at most two lines.
  public static let nameSize = 9.0
  public static let nameLineHeight = 9.0 * 1.1
  public static let nameMaxLines = 2
  /// `.detail`: 7pt, line-height 1.1, one line.
  public static let detailSize = 7.0
  public static let detailLineHeight = 7.0 * 1.1
  /// `.price`: 11pt bold, line-height 1.2.
  public static let priceSize = 11.0
  public static let priceLineHeight = 11.0 * 1.2
  /// `.bars`: what is left, at least 0.3in.
  public static let barsMinHeight = 0.3 * 72
  /// `.code`: 7pt, centered, the font's normal line height.
  public static let codeSize = 7.0
  public static let codeLineHeight = 7.0 * 1.15
  /// `barcodeSvg`'s quiet zone: ten modules a side.
  public static let quietModules = 10
}

/// Where each part of a label goes on its page. Rects are top-left origin.
public struct LabelLayout: Equatable, Sendable {
  public var name: CGRect
  public var detail: CGRect?
  public var price: CGRect?
  public var bars: CGRect?
  public var code: CGRect?
}

/// Lays a label out on a page of `size`, the name taking `nameLines` lines (one or two), as the console's flex column does:
/// the name, the options, the price, then the bars filling what is left (never under 0.3in), the digits under them.
public func layoutLabel(size: CGSize, nameLines: Int, hasDetail: Bool, hasPrice: Bool, hasBars: Bool) -> LabelLayout {
  let x = LabelMetrics.paddingX
  let width = max(0, Double(size.width) - 2 * LabelMetrics.paddingX)
  var y = LabelMetrics.paddingY
  let lines = Double(min(LabelMetrics.nameMaxLines, max(1, nameLines)))
  let name = CGRect(x: x, y: y, width: width, height: lines * LabelMetrics.nameLineHeight)
  y += name.height
  var detail: CGRect?
  if hasDetail {
    detail = CGRect(x: x, y: y, width: width, height: LabelMetrics.detailLineHeight)
    y += LabelMetrics.detailLineHeight
  }
  var price: CGRect?
  if hasPrice {
    price = CGRect(x: x, y: y, width: width, height: LabelMetrics.priceLineHeight)
    y += LabelMetrics.priceLineHeight
  }
  var bars: CGRect?
  var code: CGRect?
  if hasBars {
    let bottom = Double(size.height) - LabelMetrics.paddingY - LabelMetrics.codeLineHeight
    let height = max(LabelMetrics.barsMinHeight, bottom - y)
    bars = CGRect(x: x, y: y, width: width, height: height)
    code = CGRect(x: x, y: y + height, width: width, height: LabelMetrics.codeLineHeight)
  }
  return LabelLayout(name: name, detail: detail, price: price, bars: bars, code: code)
}

/// The bars of `modules` across `rect`, the quiet zone either side included in the width as the console's SVG does: one
/// rect per run of bars, ready to fill.
public func barRects(_ modules: String, in rect: CGRect) -> [CGRect] {
  let quiet = LabelMetrics.quietModules
  let units = modules.count + quiet * 2
  guard units > 0, rect.width > 0 else { return [] }
  let module = Double(rect.width) / Double(units)
  var out: [CGRect] = []
  let bits = Array(modules)
  var index = 0
  while index < bits.count {
    guard bits[index] == "1" else {
      index += 1
      continue
    }
    var run = 1
    while index + run < bits.count, bits[index + run] == "1" { run += 1 }
    out.append(
      CGRect(x: Double(rect.minX) + Double(index + quiet) * module, y: rect.minY, width: Double(run) * module, height: rect.height))
    index += run
  }
  return out
}

#if canImport(UIKit) || canImport(AppKit)
  #if canImport(UIKit)
    import UIKit
    typealias LabelFont = UIFont
    typealias LabelColor = UIColor
  #else
    import AppKit
    typealias LabelFont = NSFont
    typealias LabelColor = NSColor
  #endif

  /// Draws one label into the current graphics context, its page's top-left at `origin`.
  func drawLabel(_ label: PrintLabel, size: CGSize, origin: CGPoint, in context: CGContext) {
    let width = max(0, size.width - 2 * LabelMetrics.paddingX)
    let nameFont = LabelFont.boldSystemFont(ofSize: LabelMetrics.nameSize)
    let measured = (label.name as NSString).boundingRect(
      with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin],
      attributes: [.font: nameFont], context: nil)
    let nameLines = Int((measured.height / fontLineHeight(nameFont)).rounded(.up))
    let bars = label.bars.flatMap { $0.contains("1") ? $0 : nil }
    let layout = layoutLabel(
      size: size, nameLines: nameLines, hasDetail: !(label.detail ?? "").isEmpty, hasPrice: !(label.price ?? "").isEmpty,
      hasBars: bars != nil)
    context.saveGState()
    defer { context.restoreGState() }
    context.clip(to: CGRect(origin: origin, size: size))
    func at(_ rect: CGRect) -> CGRect { rect.offsetBy(dx: origin.x, dy: origin.y) }
    // The name wraps onto its two lines and is cut off below them (`overflow: hidden`); every other line is one line,
    // cut with an ellipsis (`text-overflow: ellipsis`).
    func text(
      _ value: String, _ rect: CGRect, _ font: LabelFont, _ lineHeight: Double, center: Bool = false, kern: Double = 0,
      wraps: Bool = false
    ) {
      let style = NSMutableParagraphStyle()
      style.minimumLineHeight = lineHeight
      style.maximumLineHeight = lineHeight
      style.lineBreakMode = wraps ? .byWordWrapping : .byTruncatingTail
      style.alignment = center ? .center : .left
      (value as NSString).draw(
        with: at(rect), options: wraps ? [.usesLineFragmentOrigin] : [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
        attributes: [.font: font, .foregroundColor: LabelColor.black, .paragraphStyle: style, .kern: kern], context: nil)
    }
    text(label.name, layout.name, nameFont, LabelMetrics.nameLineHeight, wraps: true)
    if let rect = layout.detail, let detail = label.detail {
      text(detail, rect, LabelFont.systemFont(ofSize: LabelMetrics.detailSize), LabelMetrics.detailLineHeight)
    }
    if let rect = layout.price, let price = label.price {
      text(price, rect, LabelFont.boldSystemFont(ofSize: LabelMetrics.priceSize), LabelMetrics.priceLineHeight)
    }
    if let rect = layout.bars, let bars {
      context.setFillColor(CGColor(gray: 0, alpha: 1))
      context.fill(barRects(bars, in: at(rect)))
    }
    if let rect = layout.code, let code = label.code {
      // `letter-spacing: 0.05em`.
      text(code, rect, LabelFont.systemFont(ofSize: LabelMetrics.codeSize), LabelMetrics.codeLineHeight, center: true,
        kern: LabelMetrics.codeSize * 0.05)
    }
  }

  /// The height of one line of `font`.
  func fontLineHeight(_ font: LabelFont) -> CGFloat {
    #if canImport(UIKit)
      return font.lineHeight
    #else
      return font.ascender - font.descender + font.leading
    #endif
  }
#endif
