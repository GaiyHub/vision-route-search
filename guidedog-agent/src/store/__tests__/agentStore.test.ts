import {
  agentCompletionDecisionRestored,
  agentCompletionPending,
  agentCompletionResolved,
  agentCompletionSupplementStarted,
  agentStarted,
  agentStopped,
  getAgentState,
} from '../agentStore';

describe('agentStore completion phases', () => {
  afterEach(() => agentStopped());

  it('moves between decision and supplement without changing the verdict', () => {
    agentStarted('task');
    agentCompletionPending('done');
    expect(getAgentState().completionPending).toEqual({ result: 'done', phase: 'decision' });

    agentCompletionSupplementStarted();
    expect(getAgentState().completionPending).toEqual({ result: 'done', phase: 'supplement' });

    agentCompletionDecisionRestored();
    expect(getAgentState().completionPending).toEqual({ result: 'done', phase: 'decision' });

    agentCompletionResolved();
    expect(getAgentState().completionPending).toBeNull();
  });

  it('clears a pending supplement when the task stops', () => {
    agentStarted('task');
    agentCompletionPending('done');
    agentCompletionSupplementStarted();
    agentStopped();
    expect(getAgentState().completionPending).toBeNull();
  });
});
