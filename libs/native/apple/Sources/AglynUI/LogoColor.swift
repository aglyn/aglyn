// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import Foundation
import ImageIO
import Observation

/// The color taken from a workspace's logo (the last step of `resolveWorkspaceColor`, Zach 2026-10-18): the average of
/// the logo's colored pixels, read once per address and kept for the process. White, black, grey and see-through pixels
/// are left out, so a mark on a white square gives the mark's color; a logo with no color of its own gives none.
@MainActor
@Observable
public final class AglynLogoColors {
  public static let shared = AglynLogoColors()

  /// `#RRGGBB` by logo address; an address that gave no color maps to nil once read.
  public private(set) var colors: [URL: String?] = [:]
  @ObservationIgnored private var loading = Set<URL>()
  @ObservationIgnored private let session: URLSession

  public init(session: URLSession = .shared) { self.session = session }

  /// The logo's color, reading it the first time it is asked for; nil until read, or when it has none.
  public func color(for url: URL?) -> String? {
    guard let url else { return nil }
    if let known = colors[url] { return known }
    load(url)
    return nil
  }

  private func load(_ url: URL) {
    guard loading.insert(url).inserted else { return }
    let session = session
    Task {
      // An SVG logo is read as the media CDN's PNG of it, as the tile draws it (AGL-3996).
      let data = await AglynRasterArt.data(from: url, session: session)
      let hex = data.flatMap { Self.dominantColor(of: $0) }
      self.colors[url] = .some(hex)
    }
  }

  /// The average of an image's saturated, opaque pixels at 24 × 24, as `#RRGGBB`.
  public nonisolated static func dominantColor(of data: Data) -> String? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 48] as CFDictionary)
    else { return nil }
    let side = 24
    var pixels = [UInt8](repeating: 0, count: side * side * 4)
    guard
      let context = CGContext(
        data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
    var (r, g, b, n) = (0.0, 0.0, 0.0, 0.0)
    for index in stride(from: 0, to: pixels.count, by: 4) {
      let alpha = Double(pixels[index + 3]) / 255
      guard alpha > 0.6 else { continue }
      let (pr, pg, pb) = (Double(pixels[index]) / 255 / alpha, Double(pixels[index + 1]) / 255 / alpha, Double(pixels[index + 2]) / 255 / alpha)
      let high = max(pr, pg, pb)
      let low = min(pr, pg, pb)
      // Greys, near-white and near-black carry no color of their own.
      guard high - low > 0.18, high > 0.15 else { continue }
      (r, g, b, n) = (r + pr, g + pg, b + pb, n + 1)
    }
    guard n >= 4 else { return nil }
    func byte(_ value: Double) -> Int { Int((min(max(value / n, 0), 1) * 255).rounded()) }
    return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
  }
}
