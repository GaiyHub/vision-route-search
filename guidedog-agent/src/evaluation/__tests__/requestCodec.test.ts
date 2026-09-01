import {
  EvaluationContractError,
  canonicalizeEvalRequestForHash,
  decodeEvalRequestPayload,
  encodeEvalRequestPayload,
  parseEvalRequest,
} from '..';

const fixture = require('../../../../specs/pc-batch-evaluation/fixtures/eval-request-v1.json') as {
  request: Parameters<typeof encodeEvalRequestPayload>[0];
  canonicalHashInput: string;
  encodedPayload: string;
};

function expectContractCode(action: () => unknown, code: EvaluationContractError['code']): void {
  try {
    action();
    throw new Error('expected EvaluationContractError');
  } catch (error) {
    expect(error).toBeInstanceOf(EvaluationContractError);
    expect((error as EvaluationContractError).code).toBe(code);
  }
}

describe('EvalRequestV1 contract', () => {
  test('round-trips complex UTF-8 through the shared Base64URL fixture', () => {
    expect(encodeEvalRequestPayload(fixture.request)).toBe(fixture.encodedPayload);
    expect(decodeEvalRequestPayload(fixture.encodedPayload)).toEqual(fixture.request);
  });

  test('uses one stable field order for request hashing', () => {
    const { requestHash: _requestHash, ...request } = fixture.request;
    expect(canonicalizeEvalRequestForHash(request)).toBe(fixture.canonicalHashInput);
  });

  test('rejects unknown versions, fields and unsafe identifiers', () => {
    expectContractCode(() => parseEvalRequest({ ...fixture.request, schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA_VERSION');
    expectContractCode(() => parseEvalRequest({ ...fixture.request, extra: true }), 'INVALID_REQUEST');
    expectContractCode(() => parseEvalRequest({ ...fixture.request, sampleId: '../escape' }), 'INVALID_REQUEST');
  });

  test('rejects malformed payloads and invalid request bounds', () => {
    expectContractCode(() => decodeEvalRequestPayload('not+base64'), 'PAYLOAD_INVALID_BASE64URL');
    expectContractCode(() => parseEvalRequest({ ...fixture.request, timeoutMs: 0 }), 'INVALID_REQUEST');
    expectContractCode(() => parseEvalRequest({ ...fixture.request, instruction: ' ' }), 'INVALID_REQUEST');
  });
});
