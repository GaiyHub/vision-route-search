# Spec：`eval-dataset`

## 目标

提供带版本、可复现的评测集与样本事实来源。

## 文件契约

- 支持 YAML 和 JSON，包含 `schemaVersion`、评测集元数据、默认配置和有序 `samples` 数组。
- 评测集 ID、样本 ID 必须稳定且唯一；指令不能为空。
- 每个启用样本至少包含一条确定性断言或启用 Judge Rubric。
- YAML/JSON 在边界校验后标准化为同一内部模型；错误须包含字段路径和稳定错误码。
- 导入文件默认复制到 evaluator 工作区；只有明确 Save 才可覆盖当前工作副本。

## 样本结构

```yaml
schemaVersion: 1
id: doupao-smoke
name: 豆泡冒烟评测
defaults:
  timeoutMs: 180000
  conversationMode: ISOLATED
samples:
  - id: answer-time
    instruction: 现在几点？
    assertions:
      - type: outcome
        equals: complete
      - type: finalResponse
        matches: "\\d{1,2}[:：]\\d{2}"
    judge:
      enabled: true
      rubric: 回答应给出清晰、合理的当前时间，不应声称执行了无关手机操作。
      threshold: 0.8
      evidence: [finalResponse, traceSummary]
```

## Setup/teardown

首版只支持强类型白名单动作：

- 启动或强制停止指定包。
- 按 Home 或 Back。
- 等待有限时长。
- 校验指定包已安装。

任意宿主机 Shell、任意 `adb shell` 字符串、清除 App 数据和自动修改豆泡设置不在首版范围内。

## Judge 配置

- 全局配置 Provider/Model；样本只保存 Rubric、阈值和证据通道，不保存 API key。
- 证据通道限定为预定义枚举，例如 `finalResponse`、`traceSummary`、`assertionSummary`、`finalScreenshot`、`uiHierarchy`。
- 请求敏感截图证据时，UI 必须明确展示将发送给远程 Provider 的内容类型。

## 验收标准

- 等价 YAML 与 JSON 生成完全相同的标准化数据。
- 重复 ID、未知字段、未知断言、非法正则、危险 setup、无效阈值和超限指令在运行前被拒绝。
- 样本顺序在执行与报告中保持不变。
- 运行开始时保存评测集快照，之后编辑不影响正在执行的 Run。
