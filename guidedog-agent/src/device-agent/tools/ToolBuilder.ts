import type { Tool, ToolProperty, ToolParameters } from '../types';

/**
 * Fluent builder for defining custom tools.
 *
 * @example
 * ```typescript
 * import { ToolBuilder } from 'react-native-device-agent';
 *
 * const myTool = new ToolBuilder('copy_text')
 *   .describe('Copy text from one field and paste it into another')
 *   .string('sourceNodeId', 'Node ID of the source field', { required: true })
 *   .string('targetNodeId', 'Node ID of the target field', { required: true })
 *   .build();
 * ```
 */
export class ToolBuilder {
  private readonly _name: string;
  private _description = '';
  private readonly _properties: Record<string, ToolProperty> = {};
  private readonly _required: string[] = [];

  constructor(name: string) {
    this._name = name;
  }

  describe(description: string): this {
    this._description = description;
    return this;
  }

  string(name: string, description: string, options?: { required?: boolean; enum?: string[] }): this {
    this._properties[name] = {
      type: 'string',
      description,
      ...(options?.enum ? { enum: options.enum } : {}),
    };
    if (options?.required) this._required.push(name);
    return this;
  }

  number(name: string, description: string, options?: { required?: boolean }): this {
    this._properties[name] = { type: 'number', description };
    if (options?.required) this._required.push(name);
    return this;
  }

  boolean(name: string, description: string, options?: { required?: boolean }): this {
    this._properties[name] = { type: 'boolean', description };
    if (options?.required) this._required.push(name);
    return this;
  }

  object(name: string, description: string, options?: { required?: boolean }): this {
    this._properties[name] = { type: 'object', description };
    if (options?.required) this._required.push(name);
    return this;
  }

  array(name: string, description: string, options?: { required?: boolean }): this {
    this._properties[name] = { type: 'array', description };
    if (options?.required) this._required.push(name);
    return this;
  }

  /** Generic param helper when type-specific methods aren't enough. */
  param(
    name: string,
    type: ToolProperty['type'],
    description: string,
    options?: { required?: boolean; enum?: string[] },
  ): this {
    this._properties[name] = {
      type,
      description,
      ...(options?.enum ? { enum: options.enum } : {}),
    };
    if (options?.required) this._required.push(name);
    return this;
  }

  build(): Tool {
    if (!this._description) {
      throw new Error(`ToolBuilder: tool "${this._name}" requires a description before build()`);
    }
    const parameters: ToolParameters = {
      type: 'object',
      properties: { ...this._properties },
      ...(this._required.length > 0 ? { required: [...this._required] } : {}),
    };
    return {
      name: this._name,
      description: this._description,
      parameters,
    };
  }
}
