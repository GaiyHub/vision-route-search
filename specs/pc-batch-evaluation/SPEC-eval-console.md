# Spec：`eval-console`

## 目标

提供简单的本地 WebUI，使开发者无需直接操作命令行或解析原始日志即可完成评测闭环。

## 页面与功能

- 评测集：列表、导入、创建、编辑、复制、校验和启停样本。
- 设备：展示 serial、型号、Android 版本、授权状态、豆泡/evaluation 包版本及就绪检查。
- Judge：配置 Provider/Model、测试连接、标记图片能力；密钥不回显。
- 运行：选择评测集和设备，启动全部或选中样本，查看运行参数快照。
- 实时进度：聚合数量、当前阶段、样本状态、耗时和取消入口。
- 样本详情：指令、完整回复、断言、Judge、工具时间线、Todo、Token、截图、UI 层级与原始产物链接。
- 报告历史：打开、导出、删除本地 Run，以及从旧 Run 创建失败重跑。

## 本地 API

- `GET /api/devices`
- `GET /api/datasets`
- `POST /api/datasets`
- `PATCH /api/datasets/:datasetId`
- `POST /api/judge/test`
- `POST /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events`，使用 SSE
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/reruns`
- `GET /api/runs/:runId/samples/:sampleId`
- `GET /api/runs/:runId/report`

请求、响应和错误体使用共享 Schema。统一错误结构：

```ts
interface ApiErrorV1 {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

## 安全

- 默认仅监听 `127.0.0.1`，不为任意 Origin 开启 CORS。
- Judge API key 仅提交给后端，不进入 URL、日志、浏览器 localStorage 或 API 响应。
- Dataset/Run/Sample ID 在解析文件路径前必须校验，防止路径穿越。
- 展示来自 Agent、网页和 Judge 的内容时视为不可信数据并完成转义。

## 交互要求

- 启动按钮在设备、evaluation 包、评测集或 Judge 配置未就绪时禁用，并展示具体原因。
- `BLOCKED` 不显示“失败”假象，明确指出需要的人工交互类型。
- `INFRA_ERROR` 与断言/Judge 的产品结果使用不同视觉和文案。
- 页面刷新后从持久化后端状态恢复，不依赖前端内存。

## 验收标准

- ADB 已安装且 evaluation APK 就绪后，用户无需终端即可完成主流程。
- SSE 断线或浏览器刷新不会丢失已完成样本与当前进度。
- 大型 Trace 不进入主 Run 响应，样本详情按需加载且页面保持可用。
