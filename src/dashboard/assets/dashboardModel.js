(function exposeDashboardModel(root, factory) {
    const model = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = model;
    } else {
        root.DashboardModel = model;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function hasGraphqlErrors(entry) {
        return entry.type === 'http'
            && Array.isArray(entry.response?.body?.errors)
            && entry.response.body.errors.length > 0;
    }

    function isFailure(entry) {
        if (entry.type === 'webhook') {
            return entry.response?.delivered === false
                || (entry.response?.status && entry.response.status >= 400);
        }

        return entry.status >= 400 || hasGraphqlErrors(entry);
    }

    function eventTitle(entry) {
        if (entry.type === 'webhook') {
            return entry.event_type || 'Webhook';
        }

        return `${entry.method || 'HTTP'} ${entry.path || ''}`.trim();
    }

    function eventStatus(entry) {
        if (entry.type === 'webhook') {
            if (entry.response?.status) {
                return String(entry.response.status);
            }

            return entry.response?.delivered ? 'Entregue' : 'Falhou';
        }

        const status = String(entry.status || '—');

        return hasGraphqlErrors(entry) ? `${status} · erro GraphQL` : status;
    }

    function filterEntries(entries, filters) {
        const search = (filters.search || '').toLowerCase();

        return entries.filter((entry) => {
            const matchesType = filters.type === 'all' || entry.type === filters.type;
            const result = isFailure(entry) ? 'error' : 'success';
            const matchesStatus = filters.status === 'all' || result === filters.status;
            const matchesSearch = !search
                || JSON.stringify(entry).toLowerCase().includes(search);

            return matchesType && matchesStatus && matchesSearch;
        });
    }

    function extractSseFrames(buffer) {
        const normalized = buffer.replace(/\r\n/g, '\n');
        const frames = normalized.split('\n\n');
        const remainder = frames.pop();

        return { frames, remainder };
    }

    function parseSseFrame(frame) {
        const lines = frame.split('\n');
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const serializedData = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');

        if (!event || !serializedData) {
            return null;
        }

        try {
            return { event, data: JSON.parse(serializedData) };
        } catch {
            return null;
        }
    }

    return {
        eventStatus,
        eventTitle,
        extractSseFrames,
        filterEntries,
        isFailure,
        parseSseFrame,
    };
}));
