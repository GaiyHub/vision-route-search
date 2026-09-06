# Spec：`adb-device-registry`

## 目标

为安卓实时镜像提供与业务无关、可持续观察的 ADB 设备注册表。该模块负责发现本机 ADB 可见设备、规范化连接状态、补充必要元数据，并通过内部接口和本地 HTTP/SSE API 向 `android-screen-capture` 与 `device-mirror-console` 提供统一设备事实。

该模块解决以下问题：

- 镜像页面不依赖评测专用 `EvaluationRuntime.listDevices()`。
- 所有消费者使用同一套 serial、连接状态、传输方式和设备元数据定义。
- 设备接入、断开、未授权和 ADB 异常能及时反映到 WebUI 和后续采集模块。
- 现有评测专用 `GET /api/devices` 契约不被破坏。
- 设备发现不读取或修改豆泡业务数据，不改变豆泡进程、Activity和任务栈状态。

## 用户故事

- 作为本地用户，我连接一台已授权的安卓设备后，可以在镜像设备列表中看到它，而不需要启动评测或安装业务 App。
- 作为本地用户，我可以看到 `unauthorized`、`offline` 等设备以及不可镜像原因。
- 作为采集模块，我可以通过 serial 获取最新设备信息，并在启动采集前确认设备仍处于可镜像状态。
- 作为 WebUI，我可以订阅设备变化，而不需要高频轮询完整设备列表。

## 技术栈

- 运行时：Node.js `>=20`、TypeScript。
- Web 服务：现有 Fastify `5.x`。
- Schema：现有 Zod `4.x`。
- ADB：Android SDK Platform Tools 中的 `adb` 可执行文件。
- 测试：Vitest、现有 Fake `ProcessAdapter` 测试模式。
- 前端消费者：现有 React `19.x`，但本模块不实现设备页面。

本模块不引入 `scrcpy`、WebRTC 或媒体处理依赖；这些属于下游模块。

## 命令

在 `evaluator/` 目录执行：

```bash
# 开发
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck

# 全量测试
npm test

# 设备注册表定向测试
npm test -- tests/adb/deviceRegistry.test.ts tests/server/androidDevicesApi.test.ts
```

当前项目未提供独立 lint 命令，不在本模块中虚构或新增 lint 流程。

## 项目结构

```text
evaluator/src/adb/
├── adbClient.ts                 # 现有通用 ADB 命令能力，按需做加法扩展
├── devices.ts                   # ADB 原始设备输出解析
└── deviceRegistry.ts            # 新增：设备注册表、观察循环与内部接口

evaluator/src/contracts/
└── androidDevices.ts            # 新增：版本化设备、分页和事件 Schema

evaluator/src/server/
├── app.ts                       # 新增通用安卓设备 HTTP/SSE 路由
└── androidDeviceRegistry.ts     # 新增：服务生命周期与依赖装配适配层

evaluator/tests/adb/
└── deviceRegistry.test.ts       # 解析、状态变化、取消和异常测试

evaluator/tests/server/
└── androidDevicesApi.test.ts    # API Schema、分页、SSE 和错误契约测试
```

允许在实现时根据现有依赖注入方式调整文件合并位置，但不得改变模块职责和公开契约。

## 领域契约

### 设备状态

```ts
type AndroidDeviceConnectionState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'UNAUTHORIZED'
  | 'UNKNOWN';

type AndroidDeviceTransport =
  | 'USB'
  | 'TCPIP'
  | 'EMULATOR'
  | 'UNKNOWN';
```

状态转换规则：

| ADB 原始状态 | `connectionState` | `canMirror` |
| --- | --- | --- |
| `device` | `ONLINE` | `true` |
| `offline` | `OFFLINE` | `false` |
| `unauthorized` | `UNAUTHORIZED` | `false` |
| 其他状态 | `UNKNOWN` | `false` |

`canMirror` 只表达 ADB 连接是否满足镜像前置条件，不表达编码器、`scrcpy-server` 或浏览器是否就绪。

### 设备描述

```ts
interface AndroidDeviceDescriptorV1 {
  schemaVersion: 1;
  serial: string;
  connectionState: AndroidDeviceConnectionState;
  canMirror: boolean;
  reason?: string;
  transport: AndroidDeviceTransport;
  transportId?: string;
  product?: string;
  model?: string;
  device?: string;
  androidVersion?: string;
  sdkLevel?: number;
  display?: {
    width: number;
    height: number;
    densityDpi?: number;
  };
  observedAt: string;
}
```

约束：

- `serial` 是设备选择和所有后续 ADB 调用的唯一标识。
- `observedAt` 使用 ISO 8601 UTC 时间。
- 未授权或离线设备不得执行需要 `adb shell` 的元数据查询。
- 元数据查询失败不得把一个已在线设备错误降级为离线；可选字段缺失并记录可观测错误。
- `display` 表示发现时观测到的物理显示信息，不作为媒体流最终编码尺寸承诺。

### 内部接口

```ts
interface AdbDeviceRegistry {
  list(input?: {
    cursor?: string;
    limit?: number;
  }): Promise<AndroidDevicePageV1>;

  get(serial: string): Promise<AndroidDeviceDescriptorV1 | undefined>;

  requireMirrorable(serial: string): Promise<AndroidDeviceDescriptorV1>;

  subscribe(signal?: AbortSignal): AsyncIterable<AndroidDeviceEventV1>;
}
```

语义：

- `get()` 对不存在设备返回 `undefined`，不把正常缺失建模为异常。
- `requireMirrorable()` 对不存在、未授权或不可用设备抛出结构化领域错误。
- `subscribe()` 首先发出一次 `SNAPSHOT`，随后只发出变化事件。
- 同一 serial 内容未变化时不得重复发出 `UPSERT`。
- 订阅取消后必须终止相关监听，不遗留长生命周期 ADB 子进程。

### 设备事件

```ts
type AndroidDeviceEventV1 =
  | {
      schemaVersion: 1;
      type: 'SNAPSHOT';
      sequence: number;
      observedAt: string;
      devices: AndroidDeviceDescriptorV1[];
    }
  | {
      schemaVersion: 1;
      type: 'UPSERT';
      sequence: number;
      observedAt: string;
      device: AndroidDeviceDescriptorV1;
    }
  | {
      schemaVersion: 1;
      type: 'REMOVE';
      sequence: number;
      observedAt: string;
      serial: string;
    }
  | {
      schemaVersion: 1;
      type: 'REGISTRY_ERROR';
      sequence: number;
      observedAt: string;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };
```

`sequence` 在单次服务进程生命周期内严格递增，用于客户端检测漏事件；它不是跨重启持久化版本号。

## ADB发现与元数据采集

- 初始快照使用参数数组调用 `adb devices -l`。
- 持续发现优先使用 ADB 的长连接设备跟踪能力；若实现选择有限间隔轮询，必须保证可取消、无重叠执行，并满足变化发现时限。
- 调用必须使用 `spawn(adbPath, args)` 或等价参数数组，不经过宿主机 Shell。
- 每条设备命令必须包含 `-s <serial>`。
- 在线设备可读取：Android版本、SDK级别、显示尺寸和密度；单项查询失败不得阻断设备列表。
- 元数据查询设置独立超时和并发上限，避免一台异常设备阻塞整个注册表。
- ADB输出属于不可信外部输入，解析失败必须产生结构化错误，不得把原始输出直接渲染到WebUI。
- ADB不可用时保留服务进程，API返回明确的 `ADB_NOT_FOUND`，并允许后续恢复。

## 本地HTTP API

### 查询设备

```http
GET /api/android/devices?limit=50&cursor=<opaque>
```

响应：

```ts
interface AndroidDevicePageV1 {
  schemaVersion: 1;
  data: AndroidDeviceDescriptorV1[];
  pagination: {
    limit: number;
    nextCursor?: string;
  };
}
```

规则：

- `limit` 默认50，最小1，最大100。
- 默认按 `serial` 升序，排序是公开契约。
- `cursor` 为不透明字符串；无效或过期游标返回 `400 INVALID_CURSOR`。
- 分页针对调用时的内存快照，不承诺跨设备变化的一致分页视图；实时变化由SSE承担。

### 订阅设备事件

```http
GET /api/android/devices/events
Accept: text/event-stream
```

SSE事件：

```text
event: android-device
id: 42
data: {"schemaVersion":1,"type":"UPSERT",...}
```

规则：

- 建立连接后首先发送 `SNAPSHOT`。
- `id` 使用事件 `sequence`。
- 服务定期发送SSE注释心跳；心跳不进入领域事件序列。
- 客户端重连后允许收到新 `SNAPSHOT`，不保证重放旧进程内事件。
- 浏览器关闭连接后必须取消该订阅；底层设备观察器由所有订阅者共享。

### 错误结构

所有HTTP错误沿用项目统一结构：

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

至少包含：

- `ADB_NOT_FOUND`
- `ADB_LIST_FAILED`
- `DEVICE_NOT_FOUND`
- `DEVICE_UNAUTHORIZED`
- `DEVICE_OFFLINE`
- `DEVICE_NOT_MIRRORABLE`
- `INVALID_CURSOR`
- `REGISTRY_STOPPED`

HTTP映射：

| 错误 | HTTP状态 |
| --- | --- |
| 请求或游标无效 | `400` |
| 设备不存在 | `404` |
| 设备当前不可镜像 | `409` |
| ADB暂时不可用 | `503` |
| 未分类内部错误 | `500` |

## 兼容性

- 现有 `AdbDevice`、`AdbClient.listDevices()` 和评测专用 `GET /api/devices` 保持兼容。
- 新契约只通过新增类型、方法和 `/api/android/devices` 路由提供。
- 不把豆泡包版本、评测接口版本或 `READY` 评测状态加入通用设备描述。
- 下游只能依赖 `AndroidDeviceDescriptorV1`，不得依赖 `adb devices -l` 的原始字段排列或错误文本。
- 后续扩展字段优先使用可选字段；删除字段、修改既有类型或改变枚举语义需要新Spec和迁移方案。

## 代码风格

遵循现有TypeScript风格：具名导出、camelCase字段、PascalCase类型、UPPER_SNAKE枚举值、参数数组执行外部命令，并通过判别联合表达事件。

```ts
export async function requireMirrorableDevice(
  registry: AdbDeviceRegistry,
  serial: string,
): Promise<AndroidDeviceDescriptorV1> {
  const device = await registry.get(serial);
  if (!device) {
    throw new AndroidDeviceRegistryError(
      'DEVICE_NOT_FOUND',
      `设备不存在：${serial}`,
      false,
    );
  }
  if (!device.canMirror) {
    throw new AndroidDeviceRegistryError(
      'DEVICE_NOT_MIRRORABLE',
      device.reason ?? `设备不可镜像：${serial}`,
      true,
    );
  }
  return device;
}
```

不得在错误信息、日志或类型中混入由宿主机Shell解释的命令字符串。

## 测试策略

### 单元测试

使用Fake `ProcessAdapter`覆盖：

- 无设备、单设备和多设备解析。
- USB、TCP/IP和模拟器传输方式识别。
- `device`、`offline`、`unauthorized`和未知状态映射。
- 元数据成功、部分失败、超时和输出异常。
- 相同快照不重复发事件。
- 接入、状态变化、移除和ADB恢复事件顺序。
- `AbortSignal`取消后不再发事件且子进程被回收。
- 分页排序、游标边界和确定性。

### API契约测试

- 所有成功响应通过共享Zod Schema。
- 所有错误响应使用统一 `ApiErrorV1`。
- `GET /api/android/devices` 分页、排序和错误映射正确。
- SSE首事件为 `SNAPSHOT`，后续序号递增。
- 多个SSE订阅者共享底层观察器，关闭后正确释放订阅。
- 现有 `GET /api/devices` 响应和测试保持不变。

### 集成与手工验证

在至少一台USB真机上验证：

1. 未授权设备能够展示为 `UNAUTHORIZED`。
2. 授权后2秒内变为 `ONLINE`。
3. 拔出USB后2秒内产生 `REMOVE` 或不可用状态更新。
4. 重新连接后无需重启服务即可恢复。
5. 同时连接两台设备时，serial和元数据不会串线。

本模块不要求媒体帧率或画面延迟测试，这些属于后续模块。

## 边界

### Always do

- 对所有ADB和HTTP边界输入执行Schema或严格解析校验。
- 所有设备命令显式传入serial。
- 为长生命周期观察和单次元数据查询提供取消与超时。
- 在提交变更前运行定向测试、全量测试、类型检查和构建。
- 保持现有评测设备API兼容。

### Ask first

- 添加新的运行时依赖或修改 `package-lock.json`。
- 修改现有 `GET /api/devices` 契约。
- 将设备状态持久化到数据库或文件。
- 改变默认监听地址、CORS或认证策略。
- 引入需要管理员权限或修改ADB全局配置的行为。

### Never do

- 通过宿主机Shell拼接并执行serial或ADB参数。
- 把 `unauthorized`、`offline` 或未知状态设备标记为可镜像。
- 因元数据查询失败而隐藏仍被ADB识别的设备。
- 将原始ADB输出、设备隐私数据或内部堆栈直接返回给浏览器。
- 启动、停止、重启、清理或注入豆泡及其他业务App进程。
- 读取或修改豆泡账号、聊天、Agent、配置、评测目录或其他业务数据。
- 在本模块中启动 `scrcpy-server`、处理媒体流或注入触控事件。
- 为实现新接口删除或放宽现有失败测试。

## 验收标准

- 已授权设备连接后2秒内出现在通用设备列表，并具有稳定serial、规范化状态和可用元数据。
- 未授权、离线和未知设备可见但 `canMirror=false`，同时提供可理解原因。
- 设备断开或状态变化后2秒内通过SSE通知订阅者。
- ADB缺失、异常退出或恢复均产生结构化状态，不导致服务崩溃或无限重启循环。
- 两个及以上消费者订阅时只运行一个底层设备观察器。
- 所有长生命周期进程均能在最后一个消费者释放或服务退出时终止。
- `GET /api/android/devices` 与SSE事件均通过版本化Schema验证。
- 现有评测专用设备发现、运行流程和API测试无回归。
- 设备注册表启动、发现、订阅和停止期间，豆泡进程PID、前后台状态、当前Activity及业务数据不因本模块发生变化。
- `npm test`、`npm run typecheck` 和 `npm run build` 全部通过。

## 开放问题

1. 首期是否只承诺macOS宿主机，还是同时把Windows和Linux纳入本模块验收矩阵？
2. 无消费者时，设备观察器应保持常驻，还是在首个API/SSE消费者出现时惰性启动，并在空闲后停止？
3. 模拟器是否与真机完全同等展示，还是在WebUI中单独分组但保持相同接口？
