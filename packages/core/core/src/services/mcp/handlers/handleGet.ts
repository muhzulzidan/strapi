import type { Core } from '@strapi/types';
import { extractSessionId } from '../internal/extractSessionId';
import { sendJsonRpcError } from '../utils/sendJsonRpcError';
import type { McpHandlerDependencies } from './types';

export const createGetHandler = (deps: McpHandlerDependencies): Core.MiddlewareHandler => {
  const { strapi, authenticationStrategy, sessionManager } = deps;

  return async (ctx) => {
    const req = ctx.req;
    const res = ctx.res;
    const sessionId = extractSessionId(req);

    const authResult = await authenticationStrategy.authenticate(ctx);
    if (authResult.authenticated === false) {
      sendJsonRpcError(res, 401, -32000, 'Unauthorized');
      return;
    }

    if (sessionId === undefined) {
      sendJsonRpcError(res, 400, -32000, 'Session ID required');
      return;
    }

    const session = sessionManager.get(sessionId);
    if (session === undefined) {
      sendJsonRpcError(res, 400, -32000, 'Invalid session');
      return;
    }
    if (String(session.adminTokenId) !== String(authResult.credentials.id)) {
      sendJsonRpcError(res, 403, -32000, 'Token mismatch for session');
      return;
    }

    // Update activity to prevent timeout during active SSE/long-polling connections.
    // GET requests in MCP context represent active client engagement waiting for
    // server messages, not idempotent data retrieval.
    session.updateActivity();

    try {
      await session.transport.handleRequest(req, res, null);
    } catch (error) {
      strapi.log.error('[MCP] Error handling GET request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      sendJsonRpcError(res, 500, -32603, 'Internal error');
    }
  };
};
