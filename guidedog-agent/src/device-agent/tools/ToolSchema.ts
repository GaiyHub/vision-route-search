import type { Tool, ToolParameters, ToolProperty } from '../types';

/**
 * Utilities for working with tool schemas.
 *
 * Handles conversion between internal Tool definitions and the JSON Schema
 * format expected by various LLM providers.
 */

/**
 * Convert an internal Tool to an OpenAI-compatible function schema.
 */
export function toOpenAIFunction(tool: Tool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: serializeProperties(tool.parameters.properties),
        required: tool.parameters.required ?? [],
        additionalProperties: false,
      },
    },
  };
}

/**
 * Convert an internal Tool to an Anthropic-compatible tool schema.
 */
export function toAnthropicTool(tool: Tool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: tool.parameters.type,
      properties: serializeProperties(tool.parameters.properties),
      required: tool.parameters.required ?? [],
      additionalProperties: false,
    },
  };
}

/**
 * Convert an internal Tool to a Gemma function-calling schema.
 *
 * Gemma uses the same JSON Schema-style format as OpenAI but wrapped
 * as a plain object without the outer "function" key.
 */
export function toGemmaFunction(tool: Tool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: tool.parameters.type,
      properties: serializeProperties(tool.parameters.properties),
      required: tool.parameters.required ?? [],
      additionalProperties: false,
    },
  };
}

/**
 * Validate a set of arguments against a tool's parameter schema.
 */
export function validateArgs(
  args: Record<string, unknown>,
  params: ToolParameters,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check required fields are present
  const required = params.required ?? [];
  for (const key of required) {
    if (!(key in args) || args[key] === undefined || args[key] === null) {
      errors.push(`Missing required argument: ${key}`);
    }
  }

  // Check types of provided arguments
  for (const [key, value] of Object.entries(args)) {
    const propSchema = params.properties[key];
    if (!propSchema) {
      errors.push(`Unknown argument: ${key}`);
      continue;
    }
    const typeError = checkType(key, value, propSchema);
    if (typeError) {
      errors.push(typeError);
    }

    // Check enum values
    if (propSchema.enum && typeof value === 'string' && !propSchema.enum.includes(value)) {
      errors.push(
        `Argument "${key}" must be one of: ${propSchema.enum.join(', ')}. Got: ${value}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Repair the narrow class of JSON-schema mistakes that compatible model
 * endpoints commonly make when serializing function arguments. Only literal
 * boolean strings are coerced, and only when the declared schema says the
 * value is boolean; arbitrary strings and numeric strings stay untouched.
 */
export function normalizeArgsBySchema(
  args: Record<string, unknown>,
  params: ToolParameters,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      const schema = params.properties[key];
      return [key, schema ? normalizeValueBySchema(value, schema) : value];
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeProperties(
  properties: Record<string, ToolProperty>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    result[key] = serializeProperty(prop);
  }
  return result;
}

function serializeProperty(prop: ToolProperty): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: prop.type };
  if (prop.description) entry.description = prop.description;
  if (prop.enum) entry.enum = prop.enum;
  if (prop.items) entry.items = serializeProperty(prop.items);
  if (prop.properties) entry.properties = serializeProperties(prop.properties);
  if (prop.required) entry.required = prop.required;
  if (prop.additionalProperties !== undefined) {
    entry.additionalProperties = prop.additionalProperties;
  }
  return entry;
}

function normalizeValueBySchema(value: unknown, schema: ToolProperty): unknown {
  if (schema.type === 'boolean' && typeof value === 'string') {
    const literal = value.trim().toLowerCase();
    if (literal === 'true') return true;
    if (literal === 'false') return false;
    return value;
  }
  if (
    schema.type === 'object' &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    schema.properties
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => {
        const childSchema = schema.properties?.[key];
        return [key, childSchema ? normalizeValueBySchema(child, childSchema) : child];
      }),
    );
  }
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    return value.map((item) => normalizeValueBySchema(item, schema.items!));
  }
  return value;
}

function checkType(
  key: string,
  value: unknown,
  schema: ToolProperty,
): string | null {
  const expectedType = schema.type;
  const actualType = typeof value;

  switch (expectedType) {
    case 'string':
      if (actualType !== 'string') return `Argument "${key}" must be a string, got ${actualType}`;
      break;
    case 'number':
      if (actualType !== 'number') return `Argument "${key}" must be a number, got ${actualType}`;
      break;
    case 'boolean':
      if (actualType !== 'boolean') return `Argument "${key}" must be a boolean, got ${actualType}`;
      break;
    case 'object':
      if (actualType !== 'object' || value === null || Array.isArray(value)) {
        return `Argument "${key}" must be an object`;
      }
      break;
    case 'array':
      if (!Array.isArray(value)) return `Argument "${key}" must be an array`;
      break;
  }
  return null;
}
