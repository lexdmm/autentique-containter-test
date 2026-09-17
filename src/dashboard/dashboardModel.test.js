const test = require('node:test');
const assert = require('node:assert/strict');
const {
    eventStatus,
    extractSseFrames,
    filterEntries,
    isFailure,
    parseSseFrame,
} = require('./assets/dashboardModel');

test('classifies GraphQL errors returned with HTTP 200 as failures', () => {
    const entry = {
        type: 'http',
        status: 200,
        response: { body: { errors: [{ message: 'Document not found' }] } },
    };

    assert.equal(isFailure(entry), true);
    assert.equal(eventStatus(entry), '200 · erro GraphQL');
});

test('keeps successful HTTP and webhook entries out of the failure count', () => {
    assert.equal(isFailure({ type: 'http', status: 200, response: { body: { data: {} } } }), false);
    assert.equal(isFailure({ type: 'webhook', response: { delivered: true, status: 200 } }), false);
    assert.equal(isFailure({ type: 'webhook', response: { delivered: false, status: 500 } }), true);
});

test('filters entries by type, result, and searchable content', () => {
    const entries = [
        { id: '1', type: 'http', status: 200, path: '/graphql', response: { body: { data: {} } } },
        { id: '2', type: 'http', status: 200, path: '/graphql', response: { body: { errors: [{}] } } },
        { id: '3', type: 'webhook', event_type: 'signature.accepted', response: { delivered: true } },
    ];

    assert.deepEqual(
        filterEntries(entries, { type: 'http', status: 'error', search: 'graphql' }).map(({ id }) => id),
        ['2'],
    );
    assert.deepEqual(
        filterEntries(entries, { type: 'webhook', status: 'all', search: 'signature' }).map(({ id }) => id),
        ['3'],
    );
});

test('extracts complete SSE frames and preserves an incomplete remainder', () => {
    const result = extractSseFrames('event: snapshot\r\ndata: []\r\n\r\nevent: activity\ndata: {');

    assert.deepEqual(result.frames, ['event: snapshot\ndata: []']);
    assert.equal(result.remainder, 'event: activity\ndata: {');
    assert.deepEqual(parseSseFrame(result.frames[0]), { event: 'snapshot', data: [] });
    assert.equal(parseSseFrame('event: activity\ndata: {invalid}'), null);
});
