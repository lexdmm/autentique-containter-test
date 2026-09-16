const { getDocument } = require('../store');
const { documentNotFoundError } = require('../lib/errors');
const { PUBLIC_BASE_URL } = require('../lib/config');

/**
 * px-torre-core sends two distinct literal queries against `document(id)`
 * (GetDocumentFiles and GetDocumentSignatureInfo), each selecting a different
 * subset of fields. A real GraphQL server would return only what was asked;
 * this always returns the combined shape instead, since both callers just
 * read the one sub-object they care about and ignore the rest.
 */
function handleDocumentQuery(variables) {
    const document = getDocument(variables.documentId);

    if (!document) {
        return documentNotFoundError();
    }

    return {
        status: 200,
        body: {
            data: {
                document: {
                    id: document.id,
                    name: document.name,
                    files: {
                        original: `${PUBLIC_BASE_URL}/files/${document.id}/original.pdf`,
                        signed: document.signed ? `${PUBLIC_BASE_URL}/files/${document.id}/signed.pdf` : null,
                    },
                    signatures: document.signatures.map((signature) => ({
                        signed: signature.signed_at ? { created_at: signature.signed_at } : null,
                    })),
                },
            },
        },
    };
}

module.exports = { handleDocumentQuery };
