# Spec：`eval-plan`

## 目标

提供独立、可复用的评测计划配置，使用户先创建计划，再从计划发起评测。评测集退回为纯样本资产，不再承载设备选择或执行入口。

一个计划至少包含名称、评测集、目标设备、执行样本和运行策略。计划可编辑，但任何修改只影响之后创建的 `PlanRun`；历史执行始终使用其不可变快照。

## 数据模型

```ts
interface EvaluationPlanV1 {
  schemaVersion: 1;
  planId: string;
  name: string;
  description?: string;
  datasetId: string;
  deviceSerial: string;
  sampleIds: string[];
  execution: {
    defaultTimeoutMs: number;
    continueOnFailure: boolean;
  };
  judge: {
    enabled: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface CreateEvaluationPlanV1 {
  name: string;
  description?: string;
  datasetId: string;
  deviceSerial: string;
  sampleIds: string[];
  execution: EvaluationPlanV1['execution'];
  judge: EvaluationPlanV1['judge'];
}
```

约束：

- `planId` 由服务端生成，格式稳定且可安全用于文件路径。
- `sampleIds` 不为空、去重且必须存在于所选评测集中。
- 创建和更新计划时验证评测集及样本引用；设备允许暂时离线，但执行前必须重新通过 readiness 检查。
- `defaultTimeoutMs` 首版限制为 10 秒至 30 分钟；`continueOnFailure` 默认 `true`；Judge 默认沿用评测集样本配置并允许计划整体关闭。
- API 输出中不包含 Judge API Key 或其他凭据。

## API

- `POST /api/plans`：创建计划，只保存配置，不启动评测。
- `GET /api/plans?cursor=&limit=`：按更新时间倒序分页列出计划摘要。
- `GET /api/plans/:planId`：读取完整计划。
- `PUT /api/plans/:planId`：完整替换可编辑配置，保留 `planId/createdAt` 并更新 `updatedAt`。

错误继续使用统一结构：

```ts
interface ApiErrorV1 {
  schemaVersion: 1;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
}
```

边界错误码至少包含 `PLAN_NOT_FOUND`、`DATASET_NOT_FOUND`、`SAMPLE_NOT_FOUND` 和 `INVALID_REQUEST`。首版不提供删除接口，避免计划与历史 Run 的引用悬空。

## 技术栈

- Node.js 20+、TypeScript、Fastify、Zod。
- JSON 文件持久化与现有原子写入工具，不引入数据库或新依赖。
- React 19 在后续 `plan-console` 模块消费本模块 API，本模块不包含页面实现。

## 命令

```bash
cd evaluator
npm run typecheck
npm test
npm run build
npm run dev
```

## 工程结构

```text
evaluator/src/plans/             计划 Schema、Repository 与领域错误
evaluator/src/server/app.ts      `/api/plans` HTTP 边界
evaluator/src/server/apiTypes.ts 共享 API 类型
evaluator/tests/plans/           Schema 与持久化测试
evaluator/tests/server/          API 集成测试
evaluator/.data/plans/           本地运行数据（不纳入 Git）
```

## 代码风格

沿用现有 ESM、Zod 边界校验与原子文件写入方式；外部输入只在 API/Repository 边界解析，内部函数消费已验证类型。

```ts
const input = createEvaluationPlanSchema.parse(request.body);
const plan = await plans.create(input);
return reply.code(201).send(plan);
```

- 类型和字段使用英文 `camelCase`；枚举使用 `UPPER_SNAKE_CASE`。
- 用户可见文案、错误说明和 Spec 使用中文。
- 不把设备探测、Run 创建或报告生成逻辑放入计划 Repository。

## 测试策略

- Schema 单测：合法边界、重复/空样本、超时范围和未知字段。
- Repository 单测：创建、读取、分页、更新、原子写入和损坏文件隔离。
- API 集成测试：状态码、统一错误体、ID 校验、评测集/样本引用校验。
- 回归验证：现有 `/api/datasets`、`/api/runs` 与样本轨迹测试继续通过。

## 边界

### 必须执行

- 所有写入使用现有原子文件工具；创建和更新前验证数据集引用。
- 计划列表只返回摘要，完整配置按需读取。
- 每个增量提交前运行 evaluator 类型检查与测试。

### 需要先确认

- 引入数据库或新 npm 依赖。
- 增加计划删除、定时调度、多设备选择或并发配置。
- 将 Judge 凭据持久化到计划。

### 禁止执行

- 创建计划时立即启动评测。
- 将运行状态、轨迹或报告写入评测集文件。
- 修改或迁移既有 Run 证据文件。
- 将设备离线等瞬时状态持久化为计划事实。

## 验收标准

- 用户可独立创建、查看和更新评测计划，计划至少绑定一个评测集、一台设备和一个样本。
- 保存计划不会启动手机任务，也不会修改评测集。
- 无效评测集、无效样本、重复样本和非法超时被稳定拒绝。
- 设备离线时计划仍可读取和编辑；是否可执行由后续执行模块判断。
- 更新计划后，既有历史 Run 数据保持不变。
- 全部 evaluator 类型检查、测试和构建通过。

## 开放问题

当前模块无阻塞问题。计划归档、定时执行、重复次数、环境 setup/teardown 和多设备调度不进入首版。

