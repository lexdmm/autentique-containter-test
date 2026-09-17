import { buildSchema, GraphQLError } from 'graphql';
import { handleCreateDocument } from './createDocument';
import { handleDocumentQuery } from './documentQuery';
import { handleSignDocument } from './signDocument';
import type { OnSignerSigned } from './signDocument';
import type { DocumentInput, HandlerResult, SignerInput, UploadFile } from '../types';

const schema = buildSchema(`
    scalar Upload
    scalar UUID

    input DocumentInput {
        name: String!
        refusable: Boolean
        sortable: Boolean
    }

    input SignerInput {
        name: String
        email: String
        phone: String
        action: String
    }

    type Action { name: String }
    type Event { created_at: String }
    type Files { original: String, signed: String, pades: String }
    type Link { short_link: String }
    type User { id: ID, name: String, email: String, phone: String }

    type Signature {
        public_id: ID
        name: String
        email: String
        created_at: String
        action: Action
        link: Link
        user: User
        viewed: Event
        signed: Event
        rejected: Event
    }

    type Document {
        id: ID!
        name: String
        refusable: Boolean
        sortable: Boolean
        created_at: String
        files: Files
        signatures: [Signature!]
    }

    type Query { document(id: UUID!): Document }

    type Mutation {
        createDocument(
            document: DocumentInput!
            signers: [SignerInput!]!
            file: Upload!
            organization_id: Int
            folder_id: String
        ): Document
        signDocument(id: UUID!, organization_id: Int): Boolean
    }
`);

function unwrapResult(
    result: HandlerResult<Record<string, unknown>>,
    fieldName: string,
): unknown {
    const error = result.body.errors?.[0];

    if (error) {
        throw new GraphQLError(error.message, { extensions: error.extensions });
    }

    return result.body.data?.[fieldName];
}

function createRootValue({ onApiSignerSigned }: { onApiSignerSigned?: OnSignerSigned } = {}) {
    return {
        document({ id }: { id: string }) {
            return unwrapResult(handleDocumentQuery({ documentId: id }), 'document');
        },
        async createDocument({
            document,
            signers,
            file,
        }: {
            document: DocumentInput;
            signers: SignerInput[];
            file: UploadFile;
            organization_id?: number | null;
            folder_id?: string | null;
        }) {
            return unwrapResult(
                await handleCreateDocument({ document, signers }, file),
                'createDocument',
            );
        },
        async signDocument({
            id,
            organization_id: organizationId,
        }: {
            id: string;
            organization_id?: number | null;
        }) {
            return unwrapResult(
                await handleSignDocument({ documentId: id, organizationId }, onApiSignerSigned),
                'signDocument',
            );
        },
    };
}

const rootValue = createRootValue();

export { createRootValue, rootValue, schema };
