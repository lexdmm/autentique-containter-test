export interface DocumentConfigsInput {
    signature_appearance?: string | null;
}

export interface DocumentInput {
    name: string;
    refusable?: boolean | null;
    sortable?: boolean | null;
    configs?: DocumentConfigsInput | null;
}

export interface PrefilledFieldsInput {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    cpf?: string | null;
    birthdate?: string | null;
}

export interface SignerConfigsInput {
    cpf?: string | null;
    name?: string | null;
    birthdate?: string | null;
    prefilled_fields?: PrefilledFieldsInput | null;
}

export interface SignerInput {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    action?: string | null;
    delivery_method?: string | null;
    configs?: SignerConfigsInput | null;
}

export interface Signature {
    public_id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    action: string;
    created_at: string;
    signed_at: string | null;
    viewed_at: string | null;
    pending_webhook?: WebhookPayload;
}

export interface StoredDocument {
    id: string;
    name: string;
    refusable: boolean;
    sortable: boolean;
    created_at: string;
    signed: boolean;
    originalFile: Buffer;
    signedFile?: Buffer;
    signatures: Signature[];
}

export interface UploadFile {
    buffer: Buffer;
    fieldname?: string;
    mimetype: string;
    originalname: string;
    size?: number;
}

export interface SignatureWebhookData {
    public_id: string | null;
    object: 'signature';
    user: {
        name: string | null;
        company: null;
        email: string | null;
        phone: string | null;
        cpf: string | null;
        birthday: null;
    };
    mail: {
        sent: null;
        opened: null;
        refused: null;
        delivered: null;
        reason: null;
    };
    document: string;
    action: string;
    viewed: string | null;
    signed: string;
    rejected: null;
    biometric_unapproved: null;
    biometric_approved: null;
    biometric_rejected: null;
    events: readonly unknown[];
    created_at: string | null;
}

export interface WebhookPayload {
    id: string;
    object: 'webhook';
    name: string;
    format: 'json';
    url: string;
    event: {
        id: string;
        object: 'event';
        organization: number;
        type: string;
        data: SignatureWebhookData;
        previous_attributes: readonly unknown[];
        created_at: string;
    };
}

export type WebhookDeliveryResult =
    | { delivered: boolean; status: number; body: unknown }
    | { delivered: false; error: string; target: string };

export interface SigningResult {
    changed: boolean;
    completed: boolean;
    document: StoredDocument;
    signer: Signature;
}

export interface GraphqlErrorShape {
    message: string;
    extensions?: Record<string, unknown>;
}

export interface HandlerResult<TData extends Record<string, unknown>> {
    status: number;
    body: {
        data?: TData;
        errors?: GraphqlErrorShape[];
    };
}

export interface ActivityEntry extends Record<string, unknown> {
    id?: string;
    recorded_at?: string;
    type: 'http' | 'webhook';
    request_id?: string;
}

export interface ActivityLog {
    add(entry: ActivityEntry): ActivityEntry;
    list(): ActivityEntry[];
    subscribe(subscriber: (entry: ActivityEntry) => void): () => boolean;
}
