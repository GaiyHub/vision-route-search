# 评测计划化能力图

## 目标

将评测入口从“评测集”迁移为可复用的“评测计划”，使配置、单次执行、样本历次尝试、轨迹和整体报告具有稳定归属，同时保留评测集作为纯样本资产。

## 能力拆分

| 模块 ID | 职责 | 依赖 |
| --- | --- | --- |
| `eval-plan` | 管理评测计划及其数据集、设备、样本范围和执行策略配置。 | 现有 `eval-dataset`、设备发现能力 |
| `plan-execution` | 从计划创建不可变执行快照，管理 `PlanRun`、样本执行和重试 attempt。 | `eval-plan`、现有 `eval-orchestrator` |
| `plan-report` | 按单次 `PlanRun` 聚合样本最终 attempt，生成整体指标与报告。 | `plan-execution`、现有 `eval-report` |
| `plan-console` | 提供评测计划、执行记录、样本 attempt/轨迹和报告页面；评测集不再作为执行入口。 | `eval-plan`、`plan-execution`、`plan-report` |

## 数据归属

```text
EvaluationPlan
└── PlanRun（一次计划执行及不可变配置快照）
    └── SampleExecution（计划中的一个样本）
        └── SampleAttempt（首次执行或手动重试）
            ├── metrics
            ├── trace
            └── artifacts
```

- 页面以“评测计划 + 样本”为主要浏览维度；`runId` 和 `attemptId` 保留每次执行的事实边界。
- 每次启动计划产生一个 `PlanRun`；每个终态 `PlanRun` 产生一份整体报告。
- 单样本重试在原 `PlanRun` 下创建新 attempt，原 attempt 及其证据不可修改；报告使用各样本最新终态 attempt 重新计算。
- 既有 Run 以只读方式归入“历史评测”兼容视图，不改写已有文件。

## 实现顺序

```text
eval-plan → plan-execution → plan-report → plan-console
```

## 稳定边界

- `EvaluationDataset` 只定义样本、断言与 Judge 标准，不保存设备或运行状态。
- `EvaluationPlan` 是可编辑配置；`PlanRun` 必须保存创建时的计划和数据集快照，后续编辑计划不影响历史结果。
- 同一设备仍只允许一个活动 Run；首版不支持多设备并行调度。
- 轨迹和产物继续使用评测专属目录，与普通聊天和用户配置隔离。
- 新结构采用增量读取兼容，不执行破坏性历史数据迁移。

