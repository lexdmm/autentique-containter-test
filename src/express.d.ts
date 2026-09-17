declare global {
    namespace Express {
        interface Request {
            activityRequestBody?: unknown;
            activityRequestId?: string;
        }

        interface Response {
            activityResponseBody?: unknown;
        }
    }
}

export {};
