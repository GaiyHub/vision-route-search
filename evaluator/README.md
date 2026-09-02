# 豆泡批量评测台

PC 端本地 WebUI，通过 ADB 驱动用户已安装的普通豆泡 APK。评测以“评测计划”为入口，执行记录、样本 Attempt、标准化轨迹、确定性断言、LLM-as-Judge 结果和整体报告均按计划运行隔离保存。

## 启动

```bash
npm install
npm run dev
```

- WebUI：`http://127.0.0.1:5173`
- 本地 API：`http://127.0.0.1:4174`
- `DOUPAO_EVALUATOR_RUNTIME=mock npm run dev` 可使用 Mock 设备。
- `DOUPAO_EVALUATOR_DATA_DIR` 可修改评测数据目录，默认使用 `evaluator/.data`。

## LLM-as-Judge

可在 WebUI 的 `Judge` 页面配置 OpenAI-compatible Provider 并测试连接。API Key 只保存在后端进程内存，不写入浏览器存储、运行数据、轨迹或报告；后端重启后需重新输入。也可通过环境变量启动：

```bash
DOUPAO_JUDGE_BASE_URL=https://example.com/v1 \
DOUPAO_JUDGE_MODEL=judge-model \
DOUPAO_JUDGE_API_KEY=secret \
npm run dev
```

可选变量：`DOUPAO_JUDGE_TIMEOUT_MS`、`DOUPAO_JUDGE_SUPPORTS_IMAGES=true`。计划启用 Judge 且包含 Judge 样本时，配置未就绪会阻止计划启动。

## 校验

```bash
npm run typecheck
npm test
npm run build
```
