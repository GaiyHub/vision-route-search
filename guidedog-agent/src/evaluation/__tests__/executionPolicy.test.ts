import { resolveCommandExecutionPolicy } from '../executionPolicy';

describe('resolveCommandExecutionPolicy', () => {
  test('keeps the existing chat behavior by default', () => {
    expect(resolveCommandExecutionPolicy()).toEqual({
      source: 'CHAT',
      conversationMode: 'CONTINUOUS',
      completionPolicy: 'ASK_USER',
      interactionPolicy: 'WAIT_FOR_USER',
      persistUserData: true,
      persistGlobalTokens: true,
      persistResumableTask: true,
      persistTodoArtifacts: true,
      evaluationContext: undefined,
    });
  });

  test('forces evaluation isolation and non-blocking interaction behavior', () => {
    expect(resolveCommandExecutionPolicy({
      source: 'EVALUATION',
      conversationMode: 'CONTINUOUS',
      completionPolicy: 'ASK_USER',
      interactionPolicy: 'WAIT_FOR_USER',
    })).toEqual({
      source: 'EVALUATION',
      conversationMode: 'ISOLATED',
      completionPolicy: 'AUTO_ACCEPT',
      interactionPolicy: 'BLOCK',
      persistUserData: false,
      persistGlobalTokens: false,
      persistResumableTask: false,
      persistTodoArtifacts: false,
      evaluationContext: undefined,
    });
  });
});
