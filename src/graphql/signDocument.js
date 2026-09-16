const { getDocument } = require('../store');
const { signatureNotFoundError } = require('../lib/errors');
const { markDocumentSigned } = require('../lib/signing');

/**
 * Real Autentique semantics: the API-key's own account co-signs. Note this
 * mutation isn't actually exercised by px-torre-core's driver-signing flow -
 * AutentiqueDocumentService::signDocument only updates its own DB row, no
 * external call. It IS used by the company co-sign flow
 * (AutentiquePxSignatureService), which is out of scope for this mock so far.
 * Implemented here for contract completeness.
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
