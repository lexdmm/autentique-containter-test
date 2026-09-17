import { buildSignedPdf } from './pdfStamp';
import { saveSignedPdf } from './downloads';
import type { Signature, SigningResult, StoredDocument } from '../types';

const signingOperations = new WeakMap<StoredDocument, Promise<SigningResult>>();

async function signSigner(document: StoredDocument, signer: Signature): Promise<SigningResult> {
    if (signer.signed_at) {
        return {
            changed: false,
            completed: Boolean(document.signed),
            document,
            signer,
        };
    }

    const signedAt = new Date().toISOString();
    const nextSignatures = document.signatures.map((candidate) => (
        candidate === signer ? { ...candidate, signed_at: signedAt } : candidate
    ));
    const completed = nextSignatures.every((candidate) => Boolean(candidate.signed_at));
    let signedFile: Buffer | undefined;

    if (completed) {
        signedFile = await buildSignedPdf(document.originalFile, {
            documentId: document.id,
            signers: nextSignatures,
        });
        saveSignedPdf(document.id, signedFile);
    }

    signer.signed_at = signedAt;

    if (completed) {
        document.signedFile = signedFile;
        document.signed = true;
    }

    return { changed: true, completed, document, signer };
}

async function markSignerSigned(document: StoredDocument, signer: Signature): Promise<SigningResult> {
    const previous = signingOperations.get(document) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => signSigner(document, signer));
    signingOperations.set(document, operation);

    try {
        return await operation;
    } finally {
        if (signingOperations.get(document) === operation) {
            signingOperations.delete(document);
        }
    }
}

export { markSignerSigned };
