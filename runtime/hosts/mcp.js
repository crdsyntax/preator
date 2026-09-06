import { BaseHostAdapter, createHostToolInvocation, HOST_DECISIONS } from './contracts.js';
import { HostDriver } from './driver.js';

export class McpHostAdapter extends BaseHostAdapter {
  constructor({ driver = null } = {}) {
    super('mcp');
    this.driver = driver || new HostDriver();
  }

  interceptToolCall(hostInvocation, session) {
    return this.driver.evaluateInvocation(hostInvocation, session);
  }

  static parseMcpRequest(rpcJson) {
    const parsed = typeof rpcJson === 'string' ? JSON.parse(rpcJson) : rpcJson;
    if (parsed.method !== 'tools/call') {
      throw new Error(`Unsupported MCP method: '${parsed.method}'. Expected 'tools/call'`);
    }

    const params = parsed.params || {};
    return {
      rpcId: parsed.id,
      invocation: createHostToolInvocation({
        host: 'mcp',
        toolName: params.name,
        args: params.arguments || {},
        metadata: { rpcId: parsed.id }
      })
    };
  }

  static formatMcpResponse(rpcId, hostDecision, toolOutput = null) {
    if (hostDecision.decision === HOST_DECISIONS.ALLOW) {
      return {
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          content: [
            {
              type: 'text',
              text: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)
            }
          ],
          isError: false
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id: rpcId,
      result: {
        content: [
          {
            type: 'text',
            text: `[GOVERNANCE DENIAL] ${hostDecision.reason} (${hostDecision.code || 'POLICY_DENIED'})`
          }
        ],
        isError: true
      }
    };
  }
}
