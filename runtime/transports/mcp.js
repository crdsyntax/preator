import {
  createTask,
  executeTask,
  getTask,
  approveTask,
  cancelTask,
  resumeTask
} from '../../protocol/index.js';

export class McpTransport {
  constructor() {
    this.tools = [
      {
        name: 'create_task',
        description: 'Create a new governed task in Praetor (starts in initial REQUEST phase)',
        inputSchema: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: 'Goal or task requirement' },
            taskId: { type: 'string', description: 'Optional unique task ID' }
          },
          required: ['goal']
        }
      },
      {
        name: 'execute_task',
        description: 'Execute a governed task through the Praetor lifecycle FSM and return the final governed report. Present the result and stop without secondary unguided tool execution.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to execute (or goal to create and execute)' },
            goal: { type: 'string', description: 'Optional goal if creating and executing inline' }
          }
        }
      },
      {
        name: 'get_task',
        description: 'Get current status, phase, and audit seal of a Praetor task',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to query' }
          },
          required: ['taskId']
        }
      },
      {
        name: 'approve_task',
        description: 'Approve a pending human-in-the-loop gate for a Praetor task',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID with pending approval' },
            approvalId: { type: 'string', description: 'Optional specific approval ID' },
            approved: { type: 'boolean', description: 'True to approve, false to reject' },
            resolved_by: { type: 'string', description: 'Identity of the human/system resolving the approval (required)' },
            reason: { type: 'string', description: 'Optional resolution reason' }
          },
          required: ['taskId']
        }
      },
      {
        name: 'cancel_task',
        description: 'Cancel an active Praetor task session with sealed reason',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to cancel' },
            reason: { type: 'string', description: 'Reason for cancellation' }
          },
          required: ['taskId']
        }
      },
      {
        name: 'resume_task',
        description: 'Resume execution of an approved or paused Praetor task',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to resume' }
          },
          required: ['taskId']
        }
      }
    ];
  }

  async handleRpcRequest(req) {
    if (!req || typeof req !== 'object') {
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }

    if (req.method?.startsWith('notifications/') || req.id === undefined) {
      return null;
    }

    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          serverInfo: {
            name: 'praetor',
            version: '0.6.0'
          }
        }
      };
    }

    if (req.method === 'ping') {
      return { jsonrpc: '2.0', id: req.id, result: {} };
    }

    if (req.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: this.tools
        }
      };
    }

    if (req.method === 'tools/call') {
      const rawToolName = req.params?.name;
      const toolName = (typeof rawToolName === 'string' && rawToolName.startsWith('praetor_'))
        ? rawToolName.slice(8)
        : rawToolName;
      const args = req.params?.arguments || {};

      try {
        let resultPayload = null;
        let isError = false;

        switch (toolName) {
          case 'create_task': {
            if (!args.goal || typeof args.goal !== 'string' || !args.goal.trim()) {
              const err = new Error("INVALID_TASK_REQUEST: 'goal' is required");
              err.code = 'INVALID_TASK_REQUEST';
              err.category = 'VALIDATION_FAILED';
              throw err;
            }
            resultPayload = createTask({ goal: args.goal.trim(), taskId: args.taskId });
            break;
          }

          case 'execute_task': {
            let taskId = args.taskId;

            if (!taskId) {
              const goalCandidate = args.goal || (typeof args === 'string' ? args : null);
              if (typeof goalCandidate !== 'string' || goalCandidate.trim() === '') {
                const err = new Error("INVALID_TASK_REQUEST: Either 'taskId' or 'goal' is required");
                err.code = 'INVALID_TASK_REQUEST';
                err.category = 'VALIDATION_FAILED';
                throw err;
              }

              const created = createTask({ goal: goalCandidate.trim() });
              taskId = created.taskId;
            }

            const executed = await executeTask(taskId);
            isError = executed.status === 'failed';
            resultPayload = executed;
            break;
          }

          case 'get_task': {
            if (!args.taskId || typeof args.taskId !== 'string') {
              const err = new Error("INVALID_TASK_REQUEST: 'taskId' is required");
              err.code = 'INVALID_TASK_REQUEST';
              err.category = 'VALIDATION_FAILED';
              throw err;
            }
            resultPayload = getTask(args.taskId.trim());
            break;
          }

          case 'approve_task': {
            if (!args.taskId || typeof args.taskId !== 'string') {
              const err = new Error("INVALID_TASK_REQUEST: 'taskId' is required");
              err.code = 'INVALID_TASK_REQUEST';
              err.category = 'VALIDATION_FAILED';
              throw err;
            }
            resultPayload = approveTask(args.taskId.trim(), args.approvalId, {
              approved: args.approved !== false,
              resolvedBy: args.resolved_by || args.resolvedBy || 'mcp-client',
              reason: args.reason || ''
            });
            break;
          }

          case 'cancel_task': {
            if (!args.taskId || typeof args.taskId !== 'string') {
              const err = new Error("INVALID_TASK_REQUEST: 'taskId' is required");
              err.code = 'INVALID_TASK_REQUEST';
              err.category = 'VALIDATION_FAILED';
              throw err;
            }
            resultPayload = cancelTask(args.taskId.trim(), args.reason);
            break;
          }

          case 'resume_task': {
            if (!args.taskId || typeof args.taskId !== 'string') {
              const err = new Error("INVALID_TASK_REQUEST: 'taskId' is required");
              err.code = 'INVALID_TASK_REQUEST';
              err.category = 'VALIDATION_FAILED';
              throw err;
            }
            const resumed = await resumeTask(args.taskId.trim());
            isError = resumed.status === 'failed';
            resultPayload = resumed;
            break;
          }

          default:
            return {
              jsonrpc: '2.0',
              id: req.id,
              error: { code: -32601, message: `Method not found: ${rawToolName}` }
            };
        }

        const text = (resultPayload && typeof resultPayload.report === 'string' && resultPayload.report)
          ? `${resultPayload.report}\n\n${JSON.stringify(resultPayload, null, 2)}`
          : JSON.stringify(resultPayload, null, 2);

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text }],
            structuredContent: resultPayload,
            isError
          }
        };
      } catch (err) {
        const errorPayload = {
          code: err.code || 'EXECUTION_FAILED',
          category: err.category || (err.code?.includes('POLICY') || err.code?.includes('DENIED') ? 'POLICY_DENIED' : 'EXECUTION_FAILED'),
          message: err.message,
          details: err.details || null
        };

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
            structuredContent: errorPayload,
            isError: true
          }
        };
      }
    }

    return { jsonrpc: '2.0', id: req.id, result: {} };
  }

  static async runStdio() {
    const transport = new McpTransport();
    let buffer = '';

    for await (const chunk of process.stdin) {
      buffer += chunk;
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          const req = JSON.parse(line);
          const res = await transport.handleRpcRequest(req);
          if (res) {
            process.stdout.write(JSON.stringify(res) + '\n');
          }
        } catch (err) {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: err.message }
          }) + '\n');
        }
      }
    }
  }
}
