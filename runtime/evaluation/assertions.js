export class AssertionError extends Error {
  constructor(message, { expected, actual, assertionName } = {}) {
    super(message);
    this.name = 'AssertionError';
    this.code = 'ASSERTION_FAILED';
    this.assertionName = assertionName;
    this.expected = expected;
    this.actual = actual;
  }
}

export function assertLifecycle(session, expectedPhase) {
  const actual = session?.getPhase ? session.getPhase() : session?.lifecycle?.currentPhase;
  if (actual !== expectedPhase) {
    throw new AssertionError(
      `assertLifecycle failed: Expected phase '${expectedPhase}', but got '${actual}'`,
      { expected: expectedPhase, actual, assertionName: 'assertLifecycle' }
    );
  }
  return true;
}

export function assertToolDenied(result, expectedCode = null, expectedCategory = null) {
  if (!result || (result.status !== 'DENIED' && result.decision !== 'deny')) {
    const actualStatus = result?.status || result?.decision;
    throw new AssertionError(
      `assertToolDenied failed: Expected status 'DENIED' or decision 'deny', but got '${actualStatus}'`,
      { expected: 'DENIED', actual: actualStatus, assertionName: 'assertToolDenied' }
    );
  }
  const errCode = result.error?.code || result.code;
  if (expectedCode && errCode !== expectedCode) {
    throw new AssertionError(
      `assertToolDenied failed: Expected error code '${expectedCode}', but got '${errCode}'`,
      { expected: expectedCode, actual: errCode, assertionName: 'assertToolDenied' }
    );
  }
  return true;
}

export function assertToolExecuted(result) {
  if (!result || (result.status !== 'OK' && result.decision !== 'allow')) {
    const actualStatus = result?.status || result?.decision;
    throw new AssertionError(
      `assertToolExecuted failed: Expected status 'OK' or 'allow', but got '${actualStatus}' (${result?.error?.message || result?.reason || ''})`,
      { expected: 'OK', actual: actualStatus, assertionName: 'assertToolExecuted' }
    );
  }
  return true;
}

export function assertNoExecutorInvocation(executorCalls) {
  const calls = typeof executorCalls === 'function' ? executorCalls() : executorCalls;
  if (calls !== 0) {
    throw new AssertionError(
      `assertNoExecutorInvocation failed: Underlying executor was invoked ${calls} times, expected 0`,
      { expected: 0, actual: calls, assertionName: 'assertNoExecutorInvocation' }
    );
  }
  return true;
}

export function assertAgentIdentity(session, expectedId) {
  const actualSessionId = session?.state?.agentId;
  const actualDefId = session?.agentDefinition?.identity?.id;

  if (actualSessionId !== expectedId || actualDefId !== expectedId) {
    throw new AssertionError(
      `assertAgentIdentity failed: Expected '${expectedId}', got session '${actualSessionId}' and def '${actualDefId}'`,
      { expected: expectedId, actual: { session: actualSessionId, def: actualDefId }, assertionName: 'assertAgentIdentity' }
    );
  }
  return true;
}

export function assertCapabilitySet(agentDef, expectedTools) {
  const actual = agentDef?.capabilities?.tools || [];
  const matches = expectedTools.every(t => actual.includes(t)) && actual.length === expectedTools.length;
  if (!matches) {
    throw new AssertionError(
      `assertCapabilitySet failed: Expected tools [${expectedTools.join(', ')}], got [${actual.join(', ')}]`,
      { expected: expectedTools, actual, assertionName: 'assertCapabilitySet' }
    );
  }
  return true;
}

export function assertContextHash(bundleOrHash, expectedHash = null) {
  const actual = typeof bundleOrHash === 'string' ? bundleOrHash : bundleOrHash?.bundle_hash;
  if (!actual || typeof actual !== 'string' || actual.length !== 64) {
    throw new AssertionError(
      `assertContextHash failed: Invalid or missing SHA-256 hash '${actual}'`,
      { expected: '64-character hex string', actual, assertionName: 'assertContextHash' }
    );
  }
  if (expectedHash && actual !== expectedHash) {
    throw new AssertionError(
      `assertContextHash failed: Expected hash '${expectedHash}', got '${actual}'`,
      { expected: expectedHash, actual, assertionName: 'assertContextHash' }
    );
  }
  return true;
}

export function assertPolicyTriggered(eventsOrViolations, expectedPolicy) {
  const found = Array.isArray(eventsOrViolations) && eventsOrViolations.some(item => {
    return item.policy === expectedPolicy ||
      item.code === expectedPolicy ||
      item.error?.code === expectedPolicy ||
      item.violation?.policy === expectedPolicy;
  });

  if (!found) {
    throw new AssertionError(
      `assertPolicyTriggered failed: Policy '${expectedPolicy}' was not found in audit events`,
      { expected: expectedPolicy, actual: eventsOrViolations, assertionName: 'assertPolicyTriggered' }
    );
  }
  return true;
}

export function assertTraceSequence(events, expectedSequence) {
  const phaseEvents = events
    .filter(e => e.event_type === 'lifecycle.phase_changed' || e.type === 'lifecycle.phase_changed')
    .map(e => e.phase);

  for (let i = 0; i < expectedSequence.length; i++) {
    if (phaseEvents[i] !== expectedSequence[i]) {
      throw new AssertionError(
        `assertTraceSequence failed at step ${i}: Expected phase '${expectedSequence[i]}', got '${phaseEvents[i]}'`,
        { expected: expectedSequence, actual: phaseEvents, assertionName: 'assertTraceSequence' }
      );
    }
  }
  return true;
}
