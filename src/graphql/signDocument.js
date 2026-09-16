const { getDocument } = require('../store');
const { signatureNotFoundError } = require('../lib/errors');
const { markDocumentSigned } = require('../lib/signing');

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

    await markDocumentSigned(document);

    return { status: 200, body: { data: { signDocument: true } } };
}

module.exports = { handleSignDocument };
