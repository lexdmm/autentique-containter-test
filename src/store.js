const documents = new Map();

function saveDocument(document) {
    documents.set(document.id, document);

    return document;
}

function getDocument(id) {
    return documents.get(id);
}

function findBySignerPublicId(publicId) {
    for (const document of documents.values()) {
        if (document.signatures.some((signer) => signer.public_id === publicId)) {
            return document;
        }
    }

    return undefined;
}

module.exports = { saveDocument, getDocument, findBySignerPublicId };
