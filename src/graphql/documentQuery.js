const { getDocument } = require('../store');
const { documentNotFoundError } = require('../lib/errors');
const { PUBLIC_BASE_URL } = require('../lib/config');

/**
 * A real GraphQL server only returns the fields a query actually selects.
 * This always returns the combined `files` + `signatures` shape instead,
 * regardless of which subset was asked for - simpler to implement, and
 * harmless for any client, since it just reads the sub-object it cares about
 * and ignores the rest.
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
                        public_id: signature.public_id,
                        name: signature.name,
                        email: signature.email,
                        created_at: signature.created_at ?? null,
                        action: { name: signature.action },
                        link: signature.email || signature.name
                            ? { short_link: `${PUBLIC_BASE_URL}/sign/${signature.public_id}` }
                            : null,
                        user: null,
                        viewed: signature.viewed_at ? { created_at: signature.viewed_at } : null,
                        signed: signature.signed_at ? { created_at: signature.signed_at } : null,
                        rejected: null,
                    })),
                },
            },
        },
    };
}

module.exports = { handleDocumentQuery };
