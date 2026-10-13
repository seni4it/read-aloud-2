// Read Aloud 2: read the text in a picture with Apple's Vision (on this Mac, free, no internet).
// Usage: ocr <image file> [language,...]  ->  JSON on stdout:
//   {"lines":[{"text":"...","words":[{"text":"...","box":[x,y,w,h]}]}]}
// Boxes are fractions of the image (0..1), origin at the bottom left, as Vision gives them.
import Foundation
import Vision
import CoreGraphics
import ImageIO

let args = CommandLine.arguments
guard args.count > 1, let url = Optional(URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("usage: ocr <image> [en-US,it-IT]\n".data(using: .utf8)!); exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = args.count > 2 ? args[2].split(separator: ",").map(String.init) : ["en-US", "it-IT"]

// put the picture on white first: a see-through background would otherwise read as black
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
      let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!); exit(1)
}
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: img.width, height: img.height))
ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
let handler = VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:])
do { try handler.perform([request]) } catch {
    FileHandle.standardError.write("ocr failed: \(error)\n".data(using: .utf8)!); exit(1)
}

var lines: [[String: Any]] = []
for obs in request.results ?? [] {
    guard let best = obs.topCandidates(1).first else { continue }
    let s = best.string
    var words: [[String: Any]] = []
    s.enumerateSubstrings(in: s.startIndex..<s.endIndex, options: .byWords) { _, range, _, _ in
        // a word with the punctuation that touches it, so "end." stays one word
        var lo = range.lowerBound, hi = range.upperBound
        while lo > s.startIndex, !s[s.index(before: lo)].isWhitespace { lo = s.index(before: lo) }
        while hi < s.endIndex, !s[hi].isWhitespace { hi = s.index(after: hi) }
        if let last = words.last, let t = last["text"] as? String, s[lo..<hi] == t { return }
        if let b = try? best.boundingBox(for: lo..<hi)?.boundingBox {
            words.append(["text": String(s[lo..<hi]), "box": [b.origin.x, b.origin.y, b.size.width, b.size.height]])
        }
    }
    let b = obs.boundingBox
    lines.append(["text": s, "box": [b.origin.x, b.origin.y, b.size.width, b.size.height], "words": words])
}
let out = try JSONSerialization.data(withJSONObject: ["lines": lines])
FileHandle.standardOutput.write(out)
