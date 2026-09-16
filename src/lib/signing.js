const { buildSignedPdf } = require('./pdfStamp');
const { saveSignedPdf } = require('./downloads');

const signingOperations = new WeakMap();

async function signSigner(document, signer) {
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
    let signedFile;

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

async function markSignerSigned(document, signer) {
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

module.exports = { markSignerSigned };
