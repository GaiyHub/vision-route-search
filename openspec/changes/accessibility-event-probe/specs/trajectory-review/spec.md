## ADDED Requirements

### Requirement: 主页面展示录制记录列表
录制停止后返回主页面时，App SHALL 展示该场景下的录制记录列表。每个记录项 SHALL 显示录制时间、事件数量、截图数量。

#### Scenario: 查看录制记录
- **WHEN** 用户完成一次录制并返回主页面
- **THEN** 该场景下出现一条新的录制记录，显示录制时间和事件数

#### Scenario: 查看历史录制
- **WHEN** 用户打开某个场景
- **THEN** 该场景下所有历史录制记录均可见

### Requirement: 用户可选择记录查看轨迹详情
用户 SHALL 能点击任意录制记录进入轨迹详情页。详情页 SHALL 按时间顺序展示该录制的事件序列，每条事件显示事件类型、来源包名、时间戳、元素信息（text/className/viewIdResourceName/bounds）。

#### Scenario: 查看轨迹详情
- **WHEN** 用户点击某条录制记录
- **THEN** 进入轨迹详情页，按时间顺序展示该录制的全部事件

#### Scenario: 查看单条事件详情
- **WHEN** 用户在轨迹详情页点击某条事件
- **THEN** 展开显示该事件的全部字段（含 sourceNull 标记、坐标框、可点击状态等）

### Requirement: 轨迹详情页展示关联截图
轨迹详情页 SHALL 在对应页面切换事件处展示关联的截图缩略图。用户可点击缩略图查看大图。

#### Scenario: 截图与事件关联展示
- **WHEN** 轨迹详情页中遇到一条 TYPE_WINDOW_STATE_CHANGED 事件
- **THEN** 该事件旁显示对应的截图缩略图

#### Scenario: 查看截图大图
- **WHEN** 用户点击某张截图缩略图
- **THEN** 全屏展示该截图

### Requirement: 录制记录可导出
轨迹详情页 SHALL 提供"导出"功能，将本次录制的全部数据（events.jsonl + 截图目录）打包，通过 Share Intent 分享。

#### Scenario: 导出录制
- **WHEN** 用户在轨迹详情页点击"导出"
- **THEN** 弹出系统分享面板，用户可选择将录制数据发送到其他应用或保存
