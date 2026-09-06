## 1. AgentToolkit 定位观察

- [x] 1.1 用单个当前 observation 状态替换 `activeUiObservations` 与 `observedRefTargets`
- [x] 1.2 让坐标、OCR ref、风险说明与循环指纹统一读取当前 observation
- [x] 1.3 补充连续观察替换旧 observation 以及动作失效的覆盖测试

## 2. AgentLoop 模型观察

- [x] 2.1 用单个模型 observation 对象替换结构、截图、消费和视觉记忆字段
- [x] 2.2 固定工具结果处理为“先失效旧状态，再登记后置观察”
- [x] 2.3 补充同轮观察后页面变化不泄漏旧结构及推理重试保留观察的覆盖测试

## 3. 验证

- [x] 3.1 运行类型检查、相关测试与完整 Jest 测试集
- [x] 3.2 验证 OpenSpec change 与任务状态
