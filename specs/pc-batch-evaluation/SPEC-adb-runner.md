# Spec：`adb-runner`

## 目标

将 `doupao-eval-bridge` 封装为有超时、可取消、可测试的 PC 端设备执行 API。

## 设备发现

- 使用 `adb devices -l` 发现设备，只将状态为 `device` 的 serial 标记为可运行。
- 保留并展示 offline、unauthorized 等状态及原因，但禁止选择运行。
- 每次运行必须显式传入 serial；不得依赖 ADB 默认设备。
- 启动前验证 evaluation 包已安装、评测入口可用，并记录包版本与设备信息。

## 进程调用

- 使用 `spawn(adbPath, args)` 或等价参数数组调用方式，不经过宿主机 Shell。
- 限制 stdout/stderr 大小，为发现、启动、轮询、拉取、截图和取消分别设置超时。
- 请求 JSON 使用 Base64URL 放入 Intent extra；不得直接拼接原始指令。
- 轮询 evaluation external files 中的 `status.json`，解析前完成 Schema 校验。

## 执行语义

- 提交成功后只轮询对应 `requestId`，忽略其他历史目录。
- 传输层失败可有限重试，但必须复用原 `requestId`、`requestHash` 和 payload。
- 样本超时时先发送 cancel，再等待有限宽限期并收集已有证据；不得静默重跑原指令。
- 设备断开时终止整个 Run；当前样本记为 `INFRA_ERROR`，后续样本记为未执行。
- `RUN_ALREADY_ACTIVE` 作为明确冲突返回，不通过等待未知任务结束后自动提交。

## 错误契约

错误统一包含 `code`、人类可读 `message`、`retryable` 和可选 `details`。至少区分：

- `ADB_NOT_FOUND`
- `DEVICE_NOT_SELECTED`
- `DEVICE_UNAUTHORIZED`
- `DEVICE_OFFLINE`
- `EVALUATION_PACKAGE_MISSING`
- `EVALUATION_ENTRY_UNAVAILABLE`
- `REQUEST_REJECTED`
- `IDEMPOTENCY_CONFLICT`
- `RUN_ALREADY_ACTIVE`
- `STATUS_INVALID`
- `SAMPLE_TIMEOUT`
- `DEVICE_LOST`

## 验收标准

- Fake ADB 测试覆盖无设备、多设备、未授权、异常输出、启动失败、重复投递、超时、取消和设备断开。
- 任意合法 UTF-8 指令均不受宿主机或 Android Shell 转义影响。
- 所有重试均可证明不会导致重复执行。
