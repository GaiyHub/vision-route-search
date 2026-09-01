import {
  isValidSkillName,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  SKILL_NAME_MAX_LENGTH,
} from '../skillFile';

describe('isValidSkillName', () => {
  it('accepts lowercase slugs with letters, digits and dashes', () => {
    expect(isValidSkillName('alipay-topup')).toBe(true);
    expect(isValidSkillName('scroll-list-search')).toBe(true);
    expect(isValidSkillName('v2')).toBe(true);
  });

  it('accepts Chinese names, uppercase, spaces and underscores', () => {
    expect(isValidSkillName('支付宝充值')).toBe(true);
    expect(isValidSkillName('Alipay')).toBe(true);
    expect(isValidSkillName('支付宝 充值')).toBe(true);
    expect(isValidSkillName('alipay_topup')).toBe(true);
    expect(isValidSkillName('  支付宝充值  ')).toBe(true);
  });

  it('enforces the 30-character limit', () => {
    expect(isValidSkillName('字'.repeat(SKILL_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidSkillName('字'.repeat(SKILL_NAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('rejects path separators, symbols and empty strings', () => {
    expect(isValidSkillName('a/b')).toBe(false);
    expect(isValidSkillName('a\\b')).toBe(false);
    expect(isValidSkillName('..')).toBe(false);
    expect(isValidSkillName('a@b')).toBe(false);
    expect(isValidSkillName('a（b）')).toBe(false);
    expect(isValidSkillName('')).toBe(false);
    expect(isValidSkillName('   ')).toBe(false);
  });
});

describe('parseSkillMarkdown', () => {
  it('parses name, description and body from a canonical document', () => {
    const doc = [
      '---',
      'name: scroll-list-search',
      'description: 长列表查找流程',
      '---',
      '',
      '## 操作流程',
      '1. inspect_ui',
      '2. scroll',
    ].join('\n');
    expect(parseSkillMarkdown(doc)).toEqual({
      name: 'scroll-list-search',
      description: '长列表查找流程',
      body: '## 操作流程\n1. inspect_ui\n2. scroll',
    });
  });

  it('ignores unknown frontmatter keys', () => {
    const doc = [
      '---',
      'name: my-skill',
      'description: 说明',
      'license: MIT',
      'version: 1.0',
      '---',
      'body text',
    ].join('\n');
    expect(parseSkillMarkdown(doc)).toEqual({
      name: 'my-skill',
      description: '说明',
      body: 'body text',
    });
  });

  it('returns null when frontmatter is missing', () => {
    expect(parseSkillMarkdown('no frontmatter here')).toBeNull();
  });

  it('returns null when name is missing or invalid', () => {
    expect(
      parseSkillMarkdown('---\ndescription: 没有名字\n---\nbody'),
    ).toBeNull();
    expect(
      parseSkillMarkdown('---\nname: a/b\ndescription: x\n---\nbody'),
    ).toBeNull();
    expect(
      parseSkillMarkdown(`---\nname: ${'a'.repeat(31)}\ndescription: x\n---\nbody`),
    ).toBeNull();
  });

  it('handles a body that contains its own --- separators', () => {
    const doc = [
      '---',
      'name: a-skill',
      'description: x',
      '---',
      '## 步骤',
      '---',
      '结束',
    ].join('\n');
    const parsed = parseSkillMarkdown(doc);
    expect(parsed?.name).toBe('a-skill');
    expect(parsed?.body).toBe('## 步骤\n---\n结束');
  });
});

describe('serializeSkillMarkdown', () => {
  it('round-trips through parseSkillMarkdown', () => {
    const input = {
      name: 'alipay-topup',
      description: '支付宝充值流程',
      body: '## 操作流程\n1. 打开支付宝\n2. 点击充值',
    };
    const parsed = parseSkillMarkdown(serializeSkillMarkdown(input));
    expect(parsed).toEqual(input);
  });
});
