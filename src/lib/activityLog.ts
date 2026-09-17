import crypto from 'node:crypto';
import type { ActivityEntry, ActivityLog } from '../types';

const DEFAULT_MAX_ENTRIES = 200;
const MAX_STRING_LENGTH = 20_000;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
    'authorization',
    'birthday',
    'cookie',
    'cpf',
    'email',
    'name',
    'password',
    'phone',
    'secret',
    'setcookie',
    'token',
    'xapikey',
    'xautentiquesignature',
]);

function sanitizeString(value: string): string {
    const sanitized = value
        .replace(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}/gi, '[REDACTED_EMAIL]')
        .replace(/\b\d{11}\b/g, '[REDACTED_CPF]');

    if (sanitized.length <= MAX_STRING_LENGTH) {
        return sanitized;
    }

    return `${sanitized.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

function sanitizeTarget(value: string): string {
    try {
        const target = new URL(value);

        target.username = '';
        target.password = '';
        target.search = '';
        target.hash = '';

        return target.toString();
    } catch {
        return '[INVALID_URL]';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value: unknown, key = ''): unknown {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (SENSITIVE_KEYS.has(normalizedKey)
        || normalizedKey.endsWith('token')
        || normalizedKey.endsWith('secret')
        || normalizedKey.endsWith('password')) {
        return REDACTED;
    }

    if (Buffer.isBuffer(value)) {
        return `[binary omitted: ${value.length} bytes]`;
    }

    if (key.toLowerCase() === 'target' && typeof value === 'string') {
        return sanitizeTarget(value);
    }

    if (typeof value === 'string') {
        return sanitizeString(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (isRecord(value)) {
        if (Buffer.isBuffer(value.buffer)) {
            return {
                fieldname: value.fieldname,
                mimetype: value.mimetype,
                size: value.size,
            };
        }

        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => (
            [entryKey, sanitizeValue(entryValue, entryKey)]
        )));
    }

    return value;
}

function createActivityLog({ maxEntries = DEFAULT_MAX_ENTRIES } = {}): ActivityLog {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
        throw new Error('maxEntries must be a positive integer');
    }

    const entries: ActivityEntry[] = [];
    const subscribers = new Set<(entry: ActivityEntry) => void>();

    return {
        add(entry: ActivityEntry) {
            const id = crypto.randomUUID();
            const recordedAt = new Date().toISOString();
            const sanitized = sanitizeValue({
                ...entry,
                id,
                recorded_at: recordedAt,
            });

            if (!isRecord(sanitized)) {
                throw new Error('sanitized activity entry must be an object');
            }

            const recorded: ActivityEntry = {
                ...sanitized,
                id,
                recorded_at: recordedAt,
                type: entry.type,
            };

            entries.push(recorded);

            if (entries.length > maxEntries) {
                entries.splice(0, entries.length - maxEntries);
            }

            for (const subscriber of subscribers) {
                try {
                    subscriber(recorded);
                } catch (error) {
                    console.error(JSON.stringify({
                        level: 'error',
                        context: 'activity-subscriber',
                        message: error instanceof Error ? error.message : 'Unknown subscriber error',
                    }));
                }
            }

            return recorded;
        },
        list() {
            return entries.slice().reverse();
        },
        subscribe(subscriber: (entry: ActivityEntry) => void) {
            if (typeof subscriber !== 'function') {
                throw new Error('subscriber must be a function');
            }

            subscribers.add(subscriber);

            return () => subscribers.delete(subscriber);
        },
    };
}

export {
    createActivityLog,
    sanitizeValue,
};
