import Foundation

/// multipart/form-data body for PUT /sessions/:id/clips/:stepId: the `sidecar`
/// JSON field first (so the server can validate it before storing the video),
/// then the `clip` file. Written to a file so a large clip is streamed from
/// disk rather than held in memory.
enum MultipartBody {
    static func contentType(boundary: String) -> String {
        "multipart/form-data; boundary=\(boundary)"
    }

    static func write(
        to output: URL,
        boundary: String,
        sidecarJSON: Data,
        clipFile: URL,
        clipFilename: String = "clip.mov",
        clipContentType: String = "video/quicktime"
    ) throws {
        FileManager.default.createFile(atPath: output.path, contents: nil)
        let out = try FileHandle(forWritingTo: output)
        defer { try? out.close() }

        func text(_ s: String) throws { try out.write(contentsOf: Data(s.utf8)) }

        try text("--\(boundary)\r\n")
        try text("Content-Disposition: form-data; name=\"sidecar\"\r\n")
        try text("Content-Type: application/json\r\n\r\n")
        try out.write(contentsOf: sidecarJSON)
        try text("\r\n--\(boundary)\r\n")
        try text("Content-Disposition: form-data; name=\"clip\"; filename=\"\(clipFilename)\"\r\n")
        try text("Content-Type: \(clipContentType)\r\n\r\n")

        let input = try FileHandle(forReadingFrom: clipFile)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty {
            try out.write(contentsOf: chunk)
        }
        try text("\r\n--\(boundary)--\r\n")
    }
}

struct ClipUploadRequest: Equatable {
    let sessionId: String
    let stepId: String
    let token: String
    let clipFile: URL
    let sidecarJSON: Data
}

struct ClipUploadResponse: Decodable, Equatable {
    let clipId: String
    let status: String
}

protocol ClipUploading: AnyObject {
    func upload(_ request: ClipUploadRequest) async throws -> ClipUploadResponse
}

/// PUT /sessions/:id/clips/:stepId with the subject's session token (ADR-012, ADR-013).
final class ClipUploadClient: ClipUploading {
    private let session: URLSession
    private let scratchDirectory: URL

    init(session: URLSession = .shared, scratchDirectory: URL = FileManager.default.temporaryDirectory) {
        self.session = session
        self.scratchDirectory = scratchDirectory
    }

    func upload(_ upload: ClipUploadRequest) async throws -> ClipUploadResponse {
        let boundary = "posturepulse-\(UUID().uuidString)"
        let bodyFile = scratchDirectory.appendingPathComponent("upload-\(UUID().uuidString).multipart")
        try MultipartBody.write(to: bodyFile, boundary: boundary, sidecarJSON: upload.sidecarJSON, clipFile: upload.clipFile)
        defer { try? FileManager.default.removeItem(at: bodyFile) }

        var request = URLRequest(
            url: BackendConfig.baseURL
                .appendingPathComponent("sessions/\(upload.sessionId)/clips")
                .appendingPathComponent(upload.stepId)
        )
        request.httpMethod = "PUT"
        request.setValue(MultipartBody.contentType(boundary: boundary), forHTTPHeaderField: "content-type")
        request.authorize(with: upload.token)
        request.timeoutInterval = 300

        let (data, response) = try await session.upload(for: request, fromFile: bodyFile)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        return try JSONDecoder().decode(ClipUploadResponse.self, from: data)
    }
}
