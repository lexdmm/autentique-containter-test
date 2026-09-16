/**
 * Error shapes below mirror Autentique's documented GraphQL error format
 * (errors[].message + errors[].extensions.validation.<path>). `invalid_phone`
 * is the one exception: it is not in the public docs, it comes straight from
 * how px-torre-core's AutentiqueIntegrationService already parses it
 * (signers.0.phone / must_be_a_valid_phone_number), which is the only real
 * evidence we have for that specific case.
 */

function validationError(message, validation) {
    return { status: 200, body: { errors: [{ message, extensions: { validation } }] } };
}

function unauthorizedError() {
    return { status: 200, body: { errors: [{ message: 'Unauthorized', extensions: { code: 'unauthorized' } }] } };
}

function rateLimitError() {
    return { status: 429, body: { message: 'Too Many Attempts' } };
}

const SIMULATABLE_ERRORS = {
    unauthorized: () => unauthorizedError(),
    invalid_phone: () => validationError(
        'Validation failed for the field [signers].',
        { 'signers.0.phone': ['must_be_a_valid_phone_number'] }
    ),
    must_be_a_file: () => validationError(
        'Validation failed for the field [file].',
        { file: ['must_be_a_file'] }
    ),
    rate_limit: () => rateLimitError(),
};

function simulatedError(req) {
    const key = req.get('x-simulate-error');

    return key && SIMULATABLE_ERRORS[key] ? SIMULATABLE_ERRORS[key]() : null;
}

module.exports = { validationError, unauthorizedError, rateLimitError, simulatedError };
