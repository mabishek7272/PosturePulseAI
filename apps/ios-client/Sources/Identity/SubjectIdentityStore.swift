import Foundation
import Security

protocol SecretStore {
    func read(_ key: String) -> String?
    func write(_ key: String, value: String) -> Bool
    func delete(_ key: String)
}

struct KeychainSecretStore: SecretStore {
    private let service = "com.beaive.subject"

    private func baseQuery(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
    }

    func read(_ key: String) -> String? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ key: String, value: String) -> Bool {
        delete(key)
        var query = baseQuery(key)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    func delete(_ key: String) {
        SecItemDelete(baseQuery(key) as CFDictionary)
    }
}

/// The device's pseudonymous subject id - a random UUID, never derived from a
/// name, email or other identifier (docs/consent-and-retention.md) - and the
/// consent record granted for it.
final class SubjectIdentityStore {
    private static let pseudoIdKey = "subjectPseudoId"
    private static let consentRecordIdKey = "consentRecordId"
    private let store: SecretStore

    init(store: SecretStore = KeychainSecretStore()) {
        self.store = store
    }

    func subjectPseudoId() -> String {
        if let existing = store.read(Self.pseudoIdKey) { return existing }
        let id = UUID().uuidString.lowercased()
        _ = store.write(Self.pseudoIdKey, value: id)
        return id
    }

    var consentRecordId: String? { store.read(Self.consentRecordIdKey) }

    func saveConsentRecordId(_ id: String) {
        _ = store.write(Self.consentRecordIdKey, value: id)
    }

    func clearConsentRecordId() {
        store.delete(Self.consentRecordIdKey)
    }
}
