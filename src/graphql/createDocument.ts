import crypto from 'node:crypto';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { saveDocument } from '../store';
import { validationError } from '../lib/errors';
import { saveOriginalPdf } from '../lib/downloads';
import { PUBLIC_BASE_URL } from '../lib/config';
import type {
    DocumentInput,
    HandlerResult,
    Signature,
    SignerInput,
    StoredDocument,
    UploadFile,
} from '../types';

// Matches the examples in Autentique's docs (e.g. "+5554999999999"): a leading
// "+", then 8-15 digits. There is no documented regex, this is a best-effort
// approximation of a loose E.164 format.
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function findInvalidPhone(signers: readonly SignerInput[]): number {
    for (let index = 0; index < signers.length; index += 1) {
        const signer = signers[index];

        if (!signer) {
            continue;
        }

        const phone = signer.phone;

        if (phone && !PHONE_PATTERN.test(phone)) {
            return index;
        }
    }

    return -1;
}

function buildSignature(input: SignerInput): Signature {
    return {
        public_id: crypto.randomUUID(),
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        action: input.action ?? 'SIGN',
        created_at: new Date().toISOString(),
        signed_at: null,
        viewed_at: null,
    };
}

function toResponseSignature(signature: Signature) {
    return {
        public_id: signature.public_id,
        name: signature.name,
        email: signature.email,
        created_at: signature.created_at,
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
    };
}

async function isValidPdf(file: UploadFile): Promise<boolean> {
    if (file.mimetype !== 'application/pdf'
        || path.extname(file.originalname).toLowerCase() !== '.pdf'
        || !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return false;
    }

    try {
        const pdf = await PDFDocument.load(file.buffer);

        return pdf.getPageCount() > 0;
    } catch {
        return false;
    }
}

interface CreateDocumentVariables {
    document: DocumentInput;
    signers: SignerInput[];
}

type CreateDocumentData = {
    createDocument: {
        id: string;
        name: string;
        refusable: boolean;
        sortable: boolean;
        created_at: string;
        signatures: ReturnType<typeof toResponseSignature>[];
    };
};

async function handleCreateDocument(
    variables: CreateDocumentVariables,
    file?: UploadFile,
): Promise<HandlerResult<CreateDocumentData>> {
    const documentInput = variables.document;
    const signersInput = variables.signers;

    if (!file) {
        return validationError({ file: ['must_be_a_file'] });
    }

    const invalidPhoneIndex = findInvalidPhone(signersInput);

    if (invalidPhoneIndex !== -1) {
        return validationError({
            [`signers.${invalidPhoneIndex}.phone`]: ['must_be_a_valid_phone_number'],
        });
    }

    if (!await isValidPdf(file)) {
        return validationError({ file: ['must_be_a_valid_file'] });
    }

    const documentId = crypto.randomUUID();
    const signatures = signersInput.map(buildSignature);

    const document: StoredDocument = {
        id: documentId,
        name: documentInput.name || file.originalname,
        refusable: documentInput.refusable ?? false,
        sortable: documentInput.sortable ?? false,
        created_at: new Date().toISOString(),
        signed: false,
        originalFile: file.buffer,
        signatures,
    };

    saveOriginalPdf(documentId, file.buffer);
    saveDocument(document);

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

export { handleCreateDocument };
