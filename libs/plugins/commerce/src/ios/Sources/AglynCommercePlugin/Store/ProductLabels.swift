// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation

/*
 * PRODUCT LABELS (the products list's "Labels", AGL-3619 on the console): a
 * label per variant with its name, options, price and a barcode the register
 * scans back, printed on the device's print sheet or saved as ZPL for a
 * Zebra. The console's `printing/product-labels.ts` and
 * `barcode/barcode-encode.ts`, ported once; ProductLabelsTests replays their
 * answers from function-cases.generated.json, and the Kotlin plugin's
 * ProductLabels.kt replays the same file. The sizes, the copy limit and the
 * Code 128 table are the console's own values (ContractValues).
 */

// MARK: - Barcodes

private let eanL = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
private let eanG = eanL.map { String($0.map { $0 == "1" ? Character("0") : Character("1") }.reversed()) }
private let eanR = eanL.map { String($0.map { $0 == "1" ? Character("0") : Character("1") }) }
private let eanParity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

private func digitsOf(_ code: String) -> [Int] { code.compactMap(\.wholeNumberValue) }

/// Only the ASCII digits `0`–`9`, as JavaScript's `\d`.
private func isASCIIDigits(_ value: String) -> Bool {
  !value.isEmpty && value.unicodeScalars.allSatisfy { $0.value >= 48 && $0.value <= 57 }
}

/// Whether an EAN/UPC's last digit is its check digit (`eanCheckDigitValid`).
func eanCheckDigitValid(_ code: String) -> Bool {
  guard isASCIIDigits(code) else { return false }
  let digits = digitsOf(code)
  let body = digits.dropLast()
  var sum = 0
  for (index, digit) in body.enumerated() {
    // Weights run 3,1,3,1… from the digit nearest the check digit.
    let fromRight = body.count - 1 - index
    sum += digit * (fromRight % 2 == 0 ? 3 : 1)
  }
  return (10 - sum % 10) % 10 == digits.last
}

private func ean13(_ code: String) -> String {
  let digits = digitsOf(code)
  let parity = Array(eanParity[digits[0]])
  var out = "101"
  for index in 1...6 { out += (parity[index - 1] == "L" ? eanL : eanG)[digits[index]] }
  out += "01010"
  for index in 7...12 { out += eanR[digits[index]] }
  return out + "101"
}

private func ean8(_ code: String) -> String {
  let digits = digitsOf(code)
  var out = "101"
  for index in 0..<4 { out += eanL[digits[index]] }
  out += "01010"
  for index in 4..<8 { out += eanR[digits[index]] }
  return out + "101"
}

private func widthsToModules(_ widths: [Int]) -> String {
  widths.enumerated().map { index, width in String(repeating: index % 2 == 1 ? "0" : "1", count: width) }.joined()
}

/// Code 128: set C for an even run of digits (half as wide), set B otherwise.
private func code128(_ text: String) -> String {
  let patterns = ContractValues.shared.code128Patterns.map { $0.map { Int($0) } }
  let numeric = isASCIIDigits(text) && text.count % 2 == 0 && text.count >= 4
  var values = [numeric ? 105 : 104]
  if numeric {
    let digits = digitsOf(text)
    for index in stride(from: 0, to: digits.count, by: 2) { values.append(digits[index] * 10 + digits[index + 1]) }
  } else {
    for unit in text.utf16 { values.append(Int(unit) - 32) }
  }
  let checksum = values.enumerated().reduce(0) { sum, item in sum + item.element * max(1, item.offset) } % 103
  values.append(contentsOf: [checksum, 106])
  return values.map { widthsToModules(patterns[$0]) }.joined()
}

/// The barcode a value prints as, or nil when it has nothing printable (`encodeBarcode`). A valid EAN-13, UPC-A or EAN-8
/// prints as itself; anything else (a SKU, an internal code) as Code 128, cut to what a 2-inch label still scans.
func encodeBarcode(_ raw: String?) -> EncodedBarcode? {
  let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if value.isEmpty { return nil }
  if isASCIIDigits(value), eanCheckDigitValid(value) {
    switch value.count {
    case 13: return EncodedBarcode(format: .ean13, modules: ean13(value), text: value)
    // UPC-A is EAN-13 with a leading zero; the bars are identical.
    case 12: return EncodedBarcode(format: .upcA, modules: ean13("0" + value), text: value)
    case 8: return EncodedBarcode(format: .ean8, modules: ean8(value), text: value)
    default: break
    }
  }
  let scalars = value.unicodeScalars.filter { $0.value >= 0x20 && $0.value <= 0x7E }
  let printable = String(String.UnicodeScalarView(scalars.prefix(ContractValues.shared.labelCodeMaxLength)))
  if printable.isEmpty { return nil }
  return EncodedBarcode(format: .code128, modules: code128(printable), text: printable)
}

// MARK: - The label rows

/// A label the products list prints for one variant (`ProductLabelRow`).
struct ProductLabelRow: Identifiable, Hashable {
  let variantID: String
  var label: ProductLabel
  var id: String { variantID }
}

/// JavaScript's `Number(value)`: nil is `undefined` (NaN), JSON null is 0.
private func jsNumber(_ value: JSONValue?) -> Double {
  switch value {
  case .number(let number): return number
  case .null: return 0
  case .bool(let flag): return flag ? 1 : 0
  case .string(let text):
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return 0 }
    return Double(trimmed) ?? .nan
  default: return .nan
  }
}

/// A value as a template literal prints it, empty for a falsy one.
private func truthyText(_ value: JSONValue?) -> String? {
  switch value {
  case .string(let text): return text.isEmpty ? nil : text
  case .number(let number):
    guard number != 0, number.isFinite else { return nil }
    return number == number.rounded() && abs(number) < 1e15 ? String(Int(number)) : String(number)
  case .bool(true): return "true"
  default: return nil
  }
}

/// The labels a product prints (`productLabelRows`): one row per variant, its options as the detail (in key order, as
/// Firestore reads a map), its price and the code the register looks up, the barcode or else the SKU.
func productLabelRows(_ product: JSONValue) -> [ProductLabelRow] {
  let name = product["name"]?.stringValue ?? ""
  return (product["variants"]?.arrayValue ?? []).map { variant in
    var options: [String] = []
    if case .object(let map)? = variant["options"] {
      options = map.keys.sorted().compactMap { truthyText(map[$0]) }
    }
    let price = jsNumber(variant["priceUsd"])
    let code = (truthyText(variant["barcode"]) ?? truthyText(variant["sku"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return ProductLabelRow(
      variantID: variant["id"]?.stringValue ?? "",
      label: ProductLabel(
        code: code, copies: 1, currency: "usd", detail: options.isEmpty ? nil : options.joined(separator: " / "), name: name,
        priceCents: price.isFinite ? jsRound(price * 100) : nil))
  }
}

/// A copy count kept whole, at least 0 and at most the console's limit (`labelCopiesFromInput`).
func labelCopiesFromInput(_ value: Double) -> Int {
  guard !value.isNaN else { return 0 }
  return Int(max(0, min(Double(ContractValues.shared.maxLabelCopies), value.rounded(.down))))
}

/// A typed copy count: what JavaScript's `Number` reads in it.
func labelCopiesFromInput(_ text: String) -> Int { labelCopiesFromInput(jsNumber(.string(text))) }

private func copiesOf(_ label: ProductLabel) -> Int { labelCopiesFromInput(Double(label.copies)) }

/// The rows that print: a code and at least one copy (`printableLabelRows`).
func printableLabels(_ labels: [ProductLabel]) -> [ProductLabel] { labels.filter { !$0.code.isEmpty && copiesOf($0) > 0 } }

/// How many labels print in all (`labelCopiesTotal`).
func labelCopiesTotal(_ labels: [ProductLabel]) -> Int { printableLabels(labels).reduce(0) { $0 + copiesOf($1) } }

/// The label's price line, empty without a price (`labelPriceText`).
func labelPriceText(priceCents: Double?, currency: String?) -> String {
  guard let priceCents, priceCents.isFinite else { return "" }
  return formatReceiptMoney(jsRound(priceCents), currency: currency ?? "usd")
}

/// The size picked, or the first (`labelSize`).
func labelSize(_ id: String?) -> LabelSize {
  let sizes = ContractValues.shared.labelSizes
  return sizes.first { $0.id == id } ?? sizes[0]
}

/// The ZPL file's name (`labelsZplFileName`).
func labelsZplFileName(_ productName: String?) -> String {
  var out = ""
  var gap = false
  for scalar in (productName ?? "product").unicodeScalars {
    let ascii = scalar.value < 128 && (CharacterSet.alphanumerics.contains(scalar))
    if ascii {
      out.unicodeScalars.append(scalar)
      gap = false
    } else if !gap {
      out += "-"
      gap = true
    }
  }
  return "labels-\(out.lowercased()).zpl"
}

// MARK: - Printing and ZPL

/// The label sheet the print sheet prints: each printable row, once per copy, drawn as the console's label page.
func labelSheet(_ labels: [ProductLabel], sizeID: String?) -> LabelSheet {
  let size = labelSize(sizeID)
  var pages: [PrintLabel] = []
  for label in printableLabels(labels) {
    let encoded = encodeBarcode(label.code)
    let price = labelPriceText(priceCents: label.priceCents.map(Double.init), currency: label.currency)
    let page = PrintLabel(
      name: label.name, detail: label.detail, price: price.isEmpty ? nil : price, bars: encoded?.modules, code: encoded?.text)
    pages.append(contentsOf: Array(repeating: page, count: copiesOf(label)))
  }
  return LabelSheet(widthPoints: size.widthIn * 72, heightPoints: size.heightIn * 72, labels: pages)
}

/// Field text for ZPL (`zplText`): `^FH` makes `_` the escape, so `^`, `~` and `_` are written as hex, and the rest is
/// folded to the printer's ASCII font.
func zplText(_ value: String?) -> String {
  toPrintable(value).map { char -> String in
    switch char {
    case "_": "_5F"
    case "^": "_5E"
    case "~": "_7E"
    default: String(char)
    }
  }.joined()
}

private func zplBarcode(_ encoded: EncodedBarcode, x: Int, y: Int, height: Int, moduleDots: Int) -> String {
  let at = "^FO\(x),\(y)^BY\(moduleDots)"
  switch encoded.format {
  case .ean13:
    // ZPL takes the 12 data digits and adds the check digit itself.
    return "\(at)^BEN,\(height),Y,N^FD\(encoded.text.prefix(12))^FS"
  case .upcA: return "\(at)^BUN,\(height),Y,N,Y^FD\(encoded.text.prefix(11))^FS"
  case .ean8: return "\(at)^B8N,\(height),Y,N^FD\(encoded.text.prefix(7))^FS"
  default:
    // Mode A: the printer picks sets B and C itself, as the page does.
    return "\(at)^BCN,\(height),Y,N,N,A^FH^FD\(zplText(encoded.text))^FS"
  }
}

/// The labels as ZPL for a Zebra (`productLabelsZpl`): one format per label, its copies as the print quantity.
func productLabelsZpl(_ labels: [ProductLabel], sizeID: String? = nil, dpi: Int = 203) -> String {
  let size = labelSize(sizeID)
  let dots = Double(dpi)
  let width = jsRound(size.widthIn * dots)
  let height = jsRound(size.heightIn * dots)
  let margin = jsRound(0.08 * dots)
  let font = jsRound(dots / 9)
  let small = jsRound(dots / 12)
  let moduleDots = dpi >= 300 ? 3 : 2
  var out: [String] = []
  for label in labels {
    let copies = copiesOf(label)
    if copies == 0 { continue }
    let encoded = encodeBarcode(label.code)
    var y = margin
    var fields: [String] = []
    fields.append("^FO\(margin),\(y)^A0N,\(font),\(font)^FB\(width - margin * 2),2,0,L^FH^FD\(zplText(label.name))^FS")
    y += font * 2 + 2
    if let detail = label.detail, !detail.isEmpty {
      fields.append("^FO\(margin),\(y)^A0N,\(small),\(small)^FB\(width - margin * 2),1,0,L^FH^FD\(zplText(detail))^FS")
      y += small + 2
    }
    let price = labelPriceText(priceCents: label.priceCents.map(Double.init), currency: label.currency)
    if !price.isEmpty {
      fields.append("^FO\(margin),\(y)^A0N,\(font),\(font)^FH^FD\(zplText(price))^FS")
      y += font + 4
    }
    if let encoded {
      // What is left of the label, less the printed digits under the bars.
      let barHeight = max(jsRound(dots * 0.2), height - y - margin - small - 4)
      fields.append(zplBarcode(encoded, x: margin, y: y, height: barHeight, moduleDots: moduleDots))
    }
    out.append("^XA^CI0^PW\(width)^LL\(height)^LH0,0\(fields.joined())^PQ\(copies),0,1,Y^XZ")
  }
  return out.joined(separator: "\n")
}
