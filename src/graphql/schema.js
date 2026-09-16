const { buildSchema, GraphQLError } = require('graphql');
const { handleCreateDocument } = require('./createDocument');
const { handleDocumentQuery } = require('./documentQuery');
const { handleSignDocument } = require('./signDocument');

const schema = buildSchema(`
    scalar Upload

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

    type Query { document(id: ID!): Document }

    type Mutation {
        createDocument(document: DocumentInput!, signers: [SignerInput!]!, file: Upload!): Document
        signDocument(id: ID!): Boolean
    }
`);

function unwrapResult(result, fieldName) {
    const error = result.body.errors?.[0];

    if (error) {
        throw new GraphQLError(error.message, { extensions: error.extensions });
    }

    return result.body.data[fieldName];
}

const rootValue = {
    document({ id }) {
        return unwrapResult(handleDocumentQuery({ documentId: id }), 'document');
    },
    createDocument({ document, signers, file }) {
        return unwrapResult(handleCreateDocument({ document, signers }, file), 'createDocument');
    },
    async signDocument({ id }) {
        return unwrapResult(await handleSignDocument({ documentId: id }), 'signDocument');
    },
};

module.exports = { schema, rootValue };
