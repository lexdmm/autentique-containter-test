const documents = new Map();

function saveDocument(document) {
    documents.set(document.id, document);

    return document;
}

function getDocument(id) {
    return documents.get(id);
}

module.exports = { saveDocument, getDocument };
