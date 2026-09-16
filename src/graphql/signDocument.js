const { getDocument } = require('../store');
const { signatureNotFoundError, documentAlreadySignedError } = require('../lib/errors');
const { markSignerSigned } = require('../lib/signing');
const { API_USER_EMAIL } = require('../lib/config');

/**
 * Real Autentique semantics: makes the API-key's own account co-sign the
 * document. Whether your integration actually calls this mutation depends
 * on your own sign flow - some apps only rely on the signature.accepted
 * webhook and never call it directly. Implemented here for completeness.
 */
async function handleSignDocument(variables) {
    const document = getDocument(variables.documentId);

    if (!document) {
        return signatureNotFoundError();
    }

    const signer = document.signatures.find((candidate) => (
        candidate.email?.toLowerCase() === API_USER_EMAIL
    ));

    if (!signer) {
        return signatureNotFoundError();
    }

    if (signer.signed_at) {
        return documentAlreadySignedError();
    }

    await markSignerSigned(document, signer);

    return { status: 200, body: { data: { signDocument: true } } };
}

module.exports = { handleSignDocument };
