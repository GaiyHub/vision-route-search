import {
  EVALUATION_HASH_PATTERN,
  EVALUATION_ID_PATTERN,
  EVALUATION_INSTRUCTION_MAX_BYTES,
  EVALUATION_PAYLOAD_MAX_BYTES,
  EVALUATION_SCHEMA_VERSION,
  EVALUATION_TIMEOUT_MAX_MS,
  EVALUATION_TIMEOUT_MIN_MS,
  EvalRequestV1,
  EvaluationContractError,
} from './contracts';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const REQUEST_KEYS = new Set([
  'schemaVersion',
  'requestId',
  'requestHash',
  'runId',
  'sampleId',
  'instruction',
  'timeoutMs',
  'conversationMode',
]);
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8Bytes(value: string): number[] {
  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    throw new EvaluationContractError('PAYLOAD_INVALID_UTF8', '文本包含无效 Unicode');
  }
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return bytes;
}

function utf8FromBytes(bytes: number[]): string {
  try {
    return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    throw new EvaluationContractError('PAYLOAD_INVALID_UTF8', 'payload 不是合法 UTF-8');
  }
}

function base64Encode(bytes: number[]): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64_ALPHABET[(combined >> 18) & 63];
    output += BASE64_ALPHABET[(combined >> 12) & 63];
    output += second === undefined ? '=' : BASE64_ALPHABET[(combined >> 6) & 63];
    output += third === undefined ? '=' : BASE64_ALPHABET[combined & 63];
  }
  return output;
}

function base64Decode(value: string): number[] {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const digits = padded.slice(index, index + 4).split('').map((char) =>
      char === '=' ? 0 : BASE64_ALPHABET.indexOf(char));
    if (digits.some((digit) => digit < 0)) {
      throw new EvaluationContractError('PAYLOAD_INVALID_BASE64URL', 'payload 不是合法 Base64URL');
    }
    const combined = (digits[0] << 18) | (digits[1] << 12) | (digits[2] << 6) | digits[3];
    bytes.push((combined >> 16) & 255);
    if (padded[index + 2] !== '=') bytes.push((combined >> 8) & 255);
    if (padded[index + 3] !== '=') bytes.push(combined & 255);
  }
  return bytes;
}

function invalidRequest(message: string, path?: string): never {
  throw new EvaluationContractError('INVALID_REQUEST', message, path);
}

export function encodeEvalRequestPayload(request: EvalRequestV1): string {
  const bytes = utf8Bytes(JSON.stringify(request));
  if (bytes.length > EVALUATION_PAYLOAD_MAX_BYTES) {
    throw new EvaluationContractError('PAYLOAD_TOO_LARGE', '评测请求超过 payload 大小限制');
  }
  return base64Encode(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function decodeEvalRequestPayload(payload: string): EvalRequestV1 {
  if (!payload || !BASE64URL_PATTERN.test(payload) || payload.length % 4 === 1) {
    throw new EvaluationContractError('PAYLOAD_INVALID_BASE64URL', 'payload 不是合法 Base64URL');
  }
  const bytes = base64Decode(payload);
  if (bytes.length > EVALUATION_PAYLOAD_MAX_BYTES) {
    throw new EvaluationContractError('PAYLOAD_TOO_LARGE', '评测请求超过 payload 大小限制');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(utf8FromBytes(bytes));
  } catch (error) {
    if (error instanceof EvaluationContractError) throw error;
    throw new EvaluationContractError('PAYLOAD_INVALID_JSON', 'payload 不是合法 JSON');
  }
  return parseEvalRequest(raw);
}

export function parseEvalRequest(raw: unknown): EvalRequestV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidRequest('请求必须是对象');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== EVALUATION_SCHEMA_VERSION) {
    throw new EvaluationContractError('UNSUPPORTED_SCHEMA_VERSION', '不支持的评测请求版本', 'schemaVersion');
  }
  for (const key of Object.keys(value)) {
    if (!REQUEST_KEYS.has(key)) invalidRequest(`未知字段：${key}`, key);
  }
  for (const id of ['requestId', 'runId', 'sampleId'] as const) {
    if (typeof value[id] !== 'string' || !EVALUATION_ID_PATTERN.test(value[id])) {
      invalidRequest(`${id} 格式无效`, id);
    }
  }
  if (typeof value.requestHash !== 'string' || !EVALUATION_HASH_PATTERN.test(value.requestHash)) {
    invalidRequest('requestHash 格式无效', 'requestHash');
  }
  if (typeof value.instruction !== 'string' || value.instruction.trim().length === 0) {
    invalidRequest('instruction 不能为空', 'instruction');
  }
  if (utf8Bytes(value.instruction).length > EVALUATION_INSTRUCTION_MAX_BYTES) {
    invalidRequest('instruction 超过大小限制', 'instruction');
  }
  if (!Number.isInteger(value.timeoutMs) ||
      (value.timeoutMs as number) < EVALUATION_TIMEOUT_MIN_MS ||
      (value.timeoutMs as number) > EVALUATION_TIMEOUT_MAX_MS) {
    invalidRequest('timeoutMs 超出允许范围', 'timeoutMs');
  }
  if (value.conversationMode !== 'ISOLATED') {
    invalidRequest('conversationMode 必须为 ISOLATED', 'conversationMode');
  }
  return value as unknown as EvalRequestV1;
}
