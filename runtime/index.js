export const VERSION = '0.3.0';
export const NAME = 'Praetor';

import * as core from './core/index.js';
import * as providers from './providers/index.js';
import * as hosts from './hosts/index.js';
import * as evaluation from './evaluation/index.js';
import * as protocol from '../protocol/index.js';
import * as transports from './transports/mcp.js';

export {
  core,
  providers,
  hosts,
  evaluation,
  protocol,
  transports
};

export { AgentSession, createSession } from './session.js';
export {
  createTask,
  executeTask,
  getTask,
  approveTask,
  cancelTask,
  resumeTask
} from '../protocol/index.js';
