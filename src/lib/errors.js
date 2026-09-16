/**
 * Error shapes below mirror Autentique's documented GraphQL error format
 * (errors[].message + errors[].extensions.validation.<path>). `invalid_phone`
 * is the one exception: it is not in the public docs. This shape
 * (signers.0.phone / must_be_a_valid_phone_number) comes from a real
 * production app's error-handling code for this exact case - the only real
 * evidence available, since Autentique never documents it.
 */

function validationError(validation) {
    return {
        status: 200,
        body: {
            errors: [{
                message: 'validation',
                extensions: { validation, category: 'validation' },
            }],
        },
    };
}

function unauthorizedError() {
    return { status: 200, body: { errors: [{ message: 'Unauthorized', extensions: { code: 'unauthorized' } }] } };
}

function rateLimitError() {
    return { status: 429, body: { message: 'Too Many Attempts' } };
}

function documentNotFoundError() {
    return {
        status: 200,
        body: { errors: [{ message: 'Document not found', extensions: { code: 'document_not_found' } }] },
    };
}

function signatureNotFoundError() {
    return {
        status: 200,
        body: { errors: [{ message: 'Signature not found', extensions: { code: 'signature_not_found' } }] },
    };
}

function documentAlreadySignedError() {
    return {
        status: 200,
        body: { errors: [{ message: 'Document was already signed', extensions: { code: 'document_signed' } }] },
    };
}

const SIMULATABLE_ERRORS = {
    unauthorized: () => unauthorizedError(),
    invalid_phone: () => validationError({
        'signers.0.phone': ['must_be_a_valid_phone_number'],
    }),
    must_be_a_file: () => validationError({ file: ['must_be_a_file'] }),
    rate_limit: () => rateLimitError(),
    document_not_found: () => documentNotFoundError(),
    signature_not_found: () => signatureNotFoundError(),
    document_signed: () => documentAlreadySignedError(),
};

function simulatedError(req) {
    const key = req.get('x-simulate-error');

    return key && SIMULATABLE_ERRORS[key] ? SIMULATABLE_ERRORS[key]() : null;
}

module.exports = {
    validationError,
    unauthorizedError,
    rateLimitError,
    documentNotFoundError,
    signatureNotFoundError,
    documentAlreadySignedError,
    simulatedError,
};
