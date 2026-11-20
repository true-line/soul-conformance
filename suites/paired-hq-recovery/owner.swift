import CryptoKit
import Foundation

// Exercise the production parser, purpose, transcript and owner-pin check.
// Only this fixture supplies the key and signature in place of hardware presence.
@main struct FixtureOwner {
    static func main() throws {
        let keyFile = URL(fileURLWithPath: CommandLine.arguments[1])
        let key = try P256.Signing.PrivateKey(rawRepresentation: Data(contentsOf: keyFile))
        let bytes = FileHandle.standardInput.readDataToEndOfFile()
        let challenge = try HQServiceRecoveryChallenge.parse(bytes, now: Int64(Date().timeIntervalSince1970))
        let request = OwnerRequest.serviceRecovery(challenge)
        let owner = key.publicKey.x963Representation
        try request.checkOwnerKey(owner)
        let signature = try key.signature(for: request.signedBytes)
        let result = ["public_key": owner.base64EncodedString(), "signature": signature.derRepresentation.base64EncodedString()]
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
    }
}
