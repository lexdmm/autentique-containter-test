import type { StoredDocument } from './types';

const documents = new Map<string, StoredDocument>();

function saveDocument(document: StoredDocument): StoredDocument {
    documents.set(document.id, document);

    return document;
}

function getDocument(id: string): StoredDocument | undefined {
    return documents.get(id);
}

function findBySignerPublicId(publicId: string): StoredDocument | undefined {
    for (const document of documents.values()) {
        if (document.signatures.some((signer) => signer.public_id === publicId)) {
            return document;
        }
    }

    return undefined;
}

export { saveDocument, getDocument, findBySignerPublicId };
