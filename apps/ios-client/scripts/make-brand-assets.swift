// Regenerates the app icon and the in-app logo from one logo PNG (mark above wordmark, white background).
//   swift scripts/make-brand-assets.swift brand/posturepulse-logo-source.png \
//     AppResources/Assets.xcassets/AppIcon.appiconset AppResources/Assets.xcassets/BrandLogo.imageset \
//     <markX,markY,markW,markH> <lockupX,lockupY,lockupW,lockupH>
// Rects are in source pixels (origin top-left). Images stay OPAQUE (the app icon must have no alpha; the in-app
// logo is blended into the paper background with multiply, which keeps the soft glow and the white spine dots).
import AppKit
import CoreImage

let a = CommandLine.arguments
guard a.count == 6 else { print("usage: make-brand-assets.swift <logo.png> <appicon dir> <logo dir> <mark rect> <lockup rect>"); exit(1) }
func rect(_ s: String) -> CGRect { let v = s.split(separator: ",").compactMap { Double($0) }; return CGRect(x: v[0], y: v[1], width: v[2], height: v[3]) }
guard let src = NSImage(contentsOf: URL(fileURLWithPath: a[1]))?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("cannot read logo"); exit(1) }
let rgb = CGColorSpaceCreateDeviceRGB()
let ci = CIContext()

func lanczos(_ img: CGImage, scale: CGFloat) -> CGImage {
    let f = CIFilter(name: "CILanczosScaleTransform")!
    f.setValue(CIImage(cgImage: img), forKey: kCIInputImageKey); f.setValue(scale, forKey: kCIInputScaleKey); f.setValue(1.0, forKey: kCIInputAspectRatioKey)
    let out = f.outputImage!
    return ci.createCGImage(out, from: out.extent, format: .RGBA8, colorSpace: rgb)!
}
func crop(_ r: CGRect) -> CGImage { src.cropping(to: r)! }   // CGImage origin is top-left
func opaque(_ w: Int, _ h: Int, draw: (CGContext) -> Void) -> CGImage {
    let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: rgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    c.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); c.fill(CGRect(x: 0, y: 0, width: w, height: h))
    c.interpolationQuality = .high
    draw(c); return c.makeImage()!
}
func write(_ img: CGImage, _ path: String) {
    let d = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(d, img, nil); precondition(CGImageDestinationFinalize(d), "write \(path)")
}

// Icon: the mark centred on a 1024 white square with ~7% margin.
let mark = crop(rect(a[4]))
let markUp = lanczos(mark, scale: 1024 * 0.86 / CGFloat(mark.width))
write(opaque(1024, 1024) { c in
    c.draw(markUp, in: CGRect(x: (1024 - CGFloat(markUp.width)) / 2, y: (1024 - CGFloat(markUp.height)) / 2, width: CGFloat(markUp.width), height: CGFloat(markUp.height)))
}, a[2] + "/AppIcon-1024.png")

// In-app logo: the full lockup at 96 pt tall for @1x/@2x/@3x.
let lock = crop(rect(a[5]))
for (name, px) in [("Logo.png", 96.0), ("Logo@2x.png", 192.0), ("Logo@3x.png", 288.0)] {
    let up = lanczos(lock, scale: CGFloat(px) / CGFloat(lock.height))
    write(opaque(up.width, up.height) { c in c.draw(up, in: CGRect(x: 0, y: 0, width: up.width, height: up.height)) }, a[3] + "/" + name)
}
print("icon \(markUp.width)x\(markUp.height) on 1024; lockup \(lock.width)x\(lock.height) source px")
