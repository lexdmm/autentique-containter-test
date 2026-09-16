const crypto = require('crypto');
const { saveDocument } = require('../store');
const { validationError } = require('../lib/errors');
const { saveOriginalPdf } = require('../lib/downloads');

// Matches the examples in Autentique's docs (e.g. "+5554999999999"): a leading
// "+", then 8-15 digits. There is no documented regex, this is a best-effort
// approximation of a loose E.164 format.
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:4100';

function findInvalidPhone(signers) {
    for (let index = 0; index < signers.length; index += 1) {
        const phone = signers[index].phone;

        if (phone && !PHONE_PATTERN.test(phone)) {
            return index;
        }
    }

    return -1;
}

function buildSignature(input) {
    return {
        public_id: crypto.randomUUID(),
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        action: input.action ?? 'SIGN',
        signed_at: null,
        viewed_at: null,
    };
}

function toResponseSignature(signature) {
    return {
        public_id: signature.public_id,
        name: signature.name,
        email: signature.email,
        created_at: null,
        action: { name: signature.action },
        link: signature.email || signature.name
            ? { short_link: `${PUBLIC_BASE_URL}/sign/${signature.public_id}` }
            : null,
        user: null,
    };
}

function handleCreateDocument(variables, file) {
    const documentInput = variables.document || {};
    const signersInput = variables.signers || [];

    if (!file) {
        return validationError('Validation failed for the field [file].', { file: ['must_be_a_file'] });
    }

    const invalidPhoneIndex = findInvalidPhone(signersInput);

    if (invalidPhoneIndex !== -1) {
        return validationError(
            'Validation failed for the field [signers].',
            { [`signers.${invalidPhoneIndex}.phone`]: ['must_be_a_valid_phone_number'] }
        );
    }

    const documentId = crypto.randomUUID();
    const signatures = signersInput.map(buildSignature);

    const document = {
        id: documentId,
        name: documentInput.name || file.originalname,
        refusable: documentInput.refusable ?? false,
        sortable: documentInput.sortable ?? false,
        created_at: new Date().toISOString(),
        signed: false,
        originalFile: file.buffer,
        signatures,
    };

    saveDocument(document);
    saveOriginalPdf(documentId, file.buffer);

    return {
        status: 200,
        body: {
            data: {
                createDocument: {
                    id: document.id,
                    name: document.name,
                    refusable: document.refusable,
                    sortable: document.sortable,
                    created_at: document.created_at,
                    signatures: signatures.map(toResponseSignature),
                },
            },
        },
    };
}

module.exports = { handleCreateDocument };
