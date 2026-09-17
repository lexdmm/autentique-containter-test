import { getDocument } from '../store';
import { documentNotFoundError } from '../lib/errors';
import { PUBLIC_BASE_URL } from '../lib/config';
import type { HandlerResult } from '../types';

interface DocumentQueryVariables {
    documentId: string;
}

function handleDocumentQuery(
    variables: DocumentQueryVariables,
): HandlerResult<{ document: Record<string, unknown> }> {
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
                    refusable: document.refusable,
                    sortable: document.sortable,
                    created_at: document.created_at,
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
                        user: {
                            id: signature.public_id,
                            name: signature.name,
                            email: signature.email,
                            phone: signature.phone,
                        },
                        viewed: signature.viewed_at ? { created_at: signature.viewed_at } : null,
                        signed: signature.signed_at ? { created_at: signature.signed_at } : null,
                        rejected: null,
                    })),
                },
            },
        },
    };
}

export { handleDocumentQuery };
