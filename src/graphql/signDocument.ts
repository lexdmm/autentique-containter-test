import { getDocument } from '../store';
import { signatureNotFoundError, documentAlreadySignedError } from '../lib/errors';
import { markSignerSigned } from '../lib/signing';
import { API_USER_EMAIL } from '../lib/config';
import type { HandlerResult, Signature, StoredDocument } from '../types';

/**
 * Real Autentique semantics: makes the API-key's own account co-sign the
 * document. Whether your integration actually calls this mutation depends
 * on your own sign flow - some apps only rely on the signature.accepted
 * webhook and never call it directly. Implemented here for completeness.
 */
interface SignDocumentVariables {
    documentId: string;
    organizationId?: number | null;
}

type OnSignerSigned = (context: {
    document: StoredDocument;
    signer: Signature;
}) => Promise<void>;

async function handleSignDocument(
    variables: SignDocumentVariables,
    onSignerSigned?: OnSignerSigned,
): Promise<HandlerResult<{ signDocument: boolean }>> {
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
        if (signer.pending_webhook && onSignerSigned) {
            await onSignerSigned({ document, signer });
        }

        return documentAlreadySignedError();
    }

    await markSignerSigned(document, signer);
    await onSignerSigned?.({ document, signer });

    return { status: 200, body: { data: { signDocument: true } } };
}

export { handleSignDocument };
export type { OnSignerSigned };
