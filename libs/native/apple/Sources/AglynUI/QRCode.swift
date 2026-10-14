// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/*
 * A QR CODE, drawn on the device. The text is encoded here and never sent
 * anywhere: a live payment URL in a third party's query string is a link that
 * pays the sale for whoever opens it (the console's QR dialog says the same,
 * AGL-1671). Error correction is the lowest level, "L", because the payment
 * page's address is long and the screen is read from a hand's length.
 */

/// The black-and-white modules of `text` as a crisp image, or nil when it cannot be encoded.
public func aglynQRCodeImage(_ text: String, pointsPerModule: CGFloat = 8) -> CGImage? {
  guard !text.isEmpty else { return nil }
  let filter = CIFilter.qrCodeGenerator()
  filter.message = Data(text.utf8)
  filter.correctionLevel = "L"
  guard let output = filter.outputImage else { return nil }
  // Nearest-neighbor scaling: whole device pixels per module, no blur.
  let scaled = output.transformed(by: CGAffineTransform(scaleX: pointsPerModule, y: pointsPerModule))
  return CIContext().createCGImage(scaled, from: scaled.extent)
}

/// A QR code of `text` on a white card with its quiet zone, sized to fit.
public struct AglynQRCode: View {
  let text: String
  let size: CGFloat

  public init(_ text: String, size: CGFloat = 256) {
    self.text = text
    self.size = size
  }

  public var body: some View {
    Group {
      if let image = aglynQRCodeImage(text) {
        Image(decorative: image, scale: 1)
          .interpolation(.none)
          .resizable()
          .scaledToFit()
          .frame(width: size, height: size)
          .padding(16)
          .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
          .accessibilityElement()
          .accessibilityLabel("Payment QR code")
      } else {
        Text("This payment page is too long to draw as a QR code.").foregroundStyle(.secondary)
      }
    }
  }
}
