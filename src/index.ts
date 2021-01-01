// @flow

import { convertNodeHttpToRequest, runHttpQuery } from 'apollo-server-core';
import { ApolloServer } from 'apollo-server-koa';
import Koa from 'koa';
import { DocumentNode, print } from 'graphql';
import httpMocks, { RequestOptions, ResponseOptions } from 'node-mocks-http';

export type ApolloServerIntegrationTestClient = {
  query: TestQuery;
  mutate: TestQuery;
  setOptions: TestSetOptions;
};
interface MockContext<RequestBody = undefined> extends Koa.Context {
  request: Koa.Context['request'] & {
    body?: RequestBody;
  };
}

const koaMockContext = <
  State = Koa.DefaultState,
  Context = MockContext,
  RequestBody = undefined
>(
  app: Koa,
  reqOptions: RequestOptions,
  resOptions: ResponseOptions,
  requestBody?: RequestBody
) => {
  const req = mockRequest(reqOptions);
  const res = mockResponse(resOptions);
  const context = app.createContext(req, res) as MockContext<RequestBody> &
    Koa.ParameterizedContext<State, Context>;
  res.statusCode = 404;
  context.request.body = requestBody;
  return context;
};

const mockRequest = (options: RequestOptions = {}) =>
  httpMocks.createRequest({
    method: 'POST',
    ...options,
  });

const mockResponse = (options: ResponseOptions = {}) =>
  httpMocks.createResponse(options);

export type StringOrAst = string | DocumentNode;
export type Options<T extends object> = { variables?: T };

export type TestClientConfig = {
  // The ApolloServer instance that will be used for handling the queries you run in your tests.
  // Must be an instance of the ApolloServer class from `apollo-server-koa` (or a compatible subclass).
  apolloServer: ApolloServer;
  // Extends the mocked Request object with additional keys.
  // Useful when your apolloServer `context` option is a callback that operates on the passed in `req` key,
  // and you want to inject data into that `req` object.
  // If you don't pass anything here, we provide a default request mock object for you.
  // See https://github.com/howardabrams/node-mocks-http#createrequest for all the default values that are included.
  extendMockRequest?: RequestOptions;
  // Extends the mocked Response object with additional keys.
  // Useful when your apolloServer `context` option is a callback that operates on the passed in `res` key,
  // and you want to inject data into that `res` object (such as `res.locals`).
  // If you don't pass anything here, we provide a default response mock object for you.
  // See https://www.npmjs.com/package/node-mocks-http#createresponse for all the default values that are included.
  extendMockResponse?: ResponseOptions;
};

export type TestQuery = <T extends object = {}, V extends object = {}>(
  operation: StringOrAst,
  { variables }?: Options<V>
) => Promise<T>;

export type TestSetOptions = (options: {
  request?: RequestOptions;
  response?: ResponseOptions;
}) => void;

// This function takes in an apollo server instance and returns a function that you can use to run operations
// against your schema, and assert on the results.
//
// Example usage:
// ```
// const apolloServer = await createApolloServer({ schema })
// const query = createTestClient({
//   apolloServer,
// });
//
// const result = await query(
//   `{ currentUser { id } }`
// )
//
// expect(result).toEqual({
//   data: {
//     currentUser: {
//       id: '1'
//     }
//   }
// });
// ```
export function createTestClient({
  apolloServer,
  extendMockRequest = {},
  extendMockResponse = {},
}: TestClientConfig): ApolloServerIntegrationTestClient {
  const app = new Koa();
  apolloServer.applyMiddleware({ app });

  let mockRequestOptions = extendMockRequest;
  let mockResponseOptions = extendMockResponse;

  /**
   * Set the options after TestClient creation
   * Useful when you don't want to create a new instance just for a specific change in the request or response.
   *  */

  const setOptions: TestSetOptions = ({
    request,
    response,
  }: {
    request?: RequestOptions;
    response?: ResponseOptions;
  }) => {
    if (request) {
      mockRequestOptions = request;
    }
    if (response) {
      mockResponseOptions = response;
    }
  };

  const test: TestQuery = async <T extends object = {}, V extends object = {}>(
    operation: StringOrAst,
    { variables }: Options<V> = {}
  ) => {
    const ctx = koaMockContext(app, mockRequestOptions, mockResponseOptions);
    const graphQLOptions = await apolloServer.createGraphQLServerOptions(ctx);

    const { graphqlResponse } = await runHttpQuery([ctx.req, ctx.res], {
      method: 'POST',
      options: graphQLOptions,
      query: {
        // operation can be a string or an AST, but `runHttpQuery` only accepts a string
        query: typeof operation === 'string' ? operation : print(operation),
        variables,
      },
      request: convertNodeHttpToRequest(ctx.req),
    });

    return JSON.parse(graphqlResponse) as T;
  };

  return {
    query: test,
    mutate: test,
    setOptions,
  };
}
