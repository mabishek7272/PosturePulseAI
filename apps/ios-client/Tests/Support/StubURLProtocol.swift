import Foundation

/// URLProtocol stub shared by the networking tests: records every request (and
/// its body, when one is attached) and answers through `responder`.
final class StubURLProtocol: URLProtocol {
    static var responder: (URLRequest) -> (status: Int, body: Data) = { _ in (200, Data()) }
    private(set) static var requests: [URLRequest] = []
    private(set) static var bodies: [Data] = []

    static func reset() {
        requests = []
        bodies = []
        responder = { _ in (200, Data()) }
    }

    static func session(status: Int, body: Data) -> URLSession {
        reset()
        responder = { _ in (status, body) }
        return session()
    }

    static func session(_ responder: @escaping (URLRequest) -> (status: Int, body: Data)) -> URLSession {
        reset()
        self.responder = responder
        return session()
    }

    private static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        Self.bodies.append(request.httpBody ?? request.httpBodyStream.map(Self.drain) ?? Data())
        let (status, body) = Self.responder(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func drain(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
