# 云顶山景区观光车排队上车与站点调度平台

把**票务、排队、车辆、站点、退票**联动起来的全栈演示系统：游客、站点工作人员、司机、调度中心、客服/主管、财务六类角色围绕**同一张车票 / 同一班车**协同处理，目标是减少热门站点拥堵，并在异常（满载跳站、误乘反方向、老人优先争议、车辆故障、司机交班延误、暴雨停运、退票争议）发生时自动联动所有相关方。

- 后端：NestJS 10 + TypeORM（**默认 SQLite，零外部依赖；可通过环境变量切换 MySQL**）
- 前端：React 18 + Vite + Ant Design 5
- 启动后自动建表并写入演示种子数据（2 条线路 / 10 个站点 / 6 辆车 / 4 名司机 / 8 张在途票与排队 / 1 条满载跳站解释记录）

---

## 一、本地启动

### 方式 A：Docker Compose 一键启动（推荐）

需要 Docker 20+ 与 Docker Compose v2。在仓库根目录：

```bash
docker compose up --build
```

- 浏览器打开 <http://localhost:8080> （Nginx 托管前端并把 `/api` 反代到后端容器）
- 后端 API：<http://localhost:3001/api>，SQLite 数据持久化在命名卷 `server-data`
- 重置演示数据：

```bash
docker compose down
docker volume rm 133-feature-1-b_server-data
docker compose up --build
```

### 方式 B：源码开发模式（两个终端）

需要 Node.js ≥ 18（开发环境为 Node 22）。需打开**两个终端**：

#### 1. 启动后端（端口 3001）

```bash
cd server
npm install
npm start
# 看到 [scenic-shuttle] API listening on http://localhost:3001/api 即成功
# 首次启动自动建表 + 写入种子数据
```

### 2. 启动前端（端口 5173）

```bash
cd web
npm install
npm run dev
```

浏览器打开 <http://localhost:5173> ，左侧切换 7 个工作台：**游客 / 站点工作人员 / 司机 / 调度中心 / 客服·主管 / 财务 / 运营复盘**。

> 如遇 npm 缓存权限错误（`EACCES ~/.npm`），可加参数：`npm install --cache /tmp/npm-cache`。

### 重置演示数据

停止后端后删除 SQLite 文件再启动即可：

```bash
rm -f server/data/app.sqlite
cd server && npm start
```

---

## 二、测试账号 / 演示身份

系统为内部平台，按**角色工作台**进入，无需登录。种子数据中的演示身份：

| 角色 | 演示身份 | 说明 |
| --- | --- | --- |
| 司机 | 王建国(1)、陈志强(2)、李海燕(3)、赵师傅(4) | 陈志强驾驶 V02 正在东门上客；李海燕连续驾驶 300 分钟被标记强制休息 |
| 车辆 | V01~V06 | V06 电量 18% 正在充电；V05 为 20 座/3 轮椅位大车；均支持或部分支持无障碍 |
| 车票 | `T20261001-001` ~ `T20261001-008` | 001~004 在东门枢纽排队（003 为轮椅老人优先组），005 已在车上；007 林晚秋、008 陈大爷（轮椅）在山顶观景台被满载跳站 |
| 站点 | 东门枢纽(1)、百花园(2)、山顶观景台(3)、玻璃栈道(4)、索道换乘(5)、南门服务区(6)；湖滨码头(7)、湿地栈道(8)、湖心岛(9)、西大门(10) | 东门/山顶/玻璃栈道/湖心岛为热门站 |
| 班次 | `TR20261001-001` | V02 上行（东门→玻璃栈道）正在上客，可直接检票 |
| 跳站记录 | `SR20261001-001` | V03（`TR…-002`）满载 10/10 越过山顶观景台：待**站点负责人确认 → 调度主管复核** |

购票后新票号显示在页面上（格式 `T20261001-xxx`），可在游客页“我的车票”或站务页扫码使用。

---

## 三、核心业务与异常联动

| 场景 | 平台行为 |
| --- | --- |
| 购票 | 记录入园时间、起终点站、同行人数、婴儿车/老人/儿童、轮椅需求、预计游览路线；无障碍/老人票自动进入**优先组** |
| 站点排队 | 平板看板：排队人数、已检票数、车辆位置、座位余量、轮椅位、天气、道路管制、本站留座规则；扫码入队自动校验始发站 |
| 检票 | 一键叫号按「优先组优先 + 同组 FIFO」；自动校验**方向**、座位/轮椅位与下游站**留座锁定** |
| 热门站排队过长 | 排队超站台容量 1.2 倍自动生成 `long_queue` 事件并推送调度加车建议 |
| **满载跳站解释** | 见下方「★ 满载跳站解释（本轮新增）」：站务/调度/游客/客服围绕**同一条 `SR` 记录**协同 |
| 误上反方向 | 检票口方向不符自动拦截；游客坚持可「强制放行」，事件同步调度安排返程衔接 |
| 老人优先争议 | 站务一键上报 `priority_dispute`，客服工作台接单并可闭环 |
| 车辆故障 | 司机上报 → 车辆转故障、在运班停运、调度派备车、游客无责退票，事件串联票/车/班 |
| 司机交班延误 | 上报后其计划班自动变「延误」并禁止再派班，看板与调度建议同步提示 |
| 暴雨临时停运 | 天气达橙色（level≥3）：一键停运所有在运/计划班；已上车票转客服无责退票，候乘游客引导离队退票；停运期间派班被阻断 |
| 退票 | 游客/站务发起 → 生成退票单+事件 → 客服核准/驳回；争议一键**升级客服主管**终局裁决 → 财务出账；每一步都写在车票时间线上 |
| 团队包车 | 申请→调度配车（校验座位/轮椅位）→车辆预留→开始用车→完单释放 |
| 无障碍 | 无障碍车辆标识、轮椅位库存、轮椅位检票占用、包车轮椅位校验 |
| 司机安全检查 | 发车前 6 项检查；任一不合格车辆自动转维保且派班被阻断 |
| 站点广播 / 限流 | 本站或全线广播；热门景点可设每小时限流人数 |
| 电子围栏 | 车辆进/出站自动记录，驱动满载跳站判定与车辆位置更新 |
| 派班校验 | 电量<20%、充电/维保/故障、包车预留、司机未签到/休息/交班延误/超时未休/达工时上限、安检未过、道路封闭、暴雨预警——任一不满足即阻断并一次性返回全部原因 |
| 运营复盘 | 站点等待（平均/最长/被跳组数）、车辆利用率（上座率/里程/电量）、投诉原因分布、退票成本按责任归类、KPI 总览 |

### ★ 满载跳站解释（本轮新增）

车辆到站（电子围栏）发现余座为 0 无法上客时，系统自动生成**一条满载跳站解释记录 `SR`**，四端围绕同一条记录协同：

| 角色 | 可见/可做 |
| --- | --- |
| **站点端** | 看到跳站原因、**车内人数**（如 14/14）、**下一班预计到达**（车次+ETA）、等待补偿、换乘建议与**等候策略**；可把滞留组转回排队、更新等候策略（游客端/调度端同步）；**站点负责人确认**后方可提交主管复核；电子围栏漏判时可站务补录 |
| **游客端** | 车票页显示「为什么跳站 / 跳站时车内人数 / 下一班何时到 / 站点等候安排 / 🎁等待补偿 / 🚶换乘建议」；可一键发起**跳站咨询/投诉**，客服回复直接显示在车票页 |
| **调度中心** | 看板「满载跳站处置」页同步全部记录与智能建议；记录会影响该站点**下一轮车辆调度**：① **临时增派空车**以本站为起点立即接驳（滞留游客自动转回排队优先检票，且校验车辆待命/电量/司机状态）；② 设置/调整**车辆不满载离站规则**（为本站预留 N 个座位，上游站检票链路强制锁定、不得卖满，设 0 解除）；**调度主管复核**（站点确认是前置条件） |
| **客服** | 工作台「满载跳站投诉」标签直接用**同一条记录**处理投诉——事实依据（车内人数/下一班/站点确认/调度处置）已在记录内，无需反复核实；办结方式：发补偿/安排换乘/引导退票/解释，结论回写游客车票页 |

- 状态机：`待站点确认 → 站点已确认·待调度 →（主管复核）→ 已闭环`；主管复核时若有未办结投诉则保持开放，客服办结后自动闭环；全部动作沉淀在记录时间线。
- 留座规则真实参与检票：设站留座 3 后，14 座车在上游站只可售 11 张，第 12 张会被「为下游站预留座位」拦截，从机制上避免再次满载越站。
- 种子内置 `SR…-001`（山顶观景台，V03 满载 10/10 越过，陈大爷轮椅滞留）可直接演示全流程；也可在司机页把 `TR…-001` 卖满后选「到站 百花园」触发新记录。

---

## 四、推荐验证路径（手工点点看）

1. **游客页**：买一张无障碍优先票（勾老人+轮椅）→ 复制票号；再查 `T20261001-008`（陈大爷，山顶观景台被跳站）可直接看到**跳站原因、车内 10/10、下一班约 9 分钟、等待补偿与换乘建议**。
2. **站务页（选山顶观景台）**：
   - 「满载跳站解释与等候策略」卡片展示 `SR…-001`；点「**站点负责人确认**」（赵站长）；可先「滞留组转回排队」、「同步等候策略」。
3. **调度中心页**：
   - 顶部智能建议提示跳站待处置；进入「**满载跳站处置**」标签：先「**设留座规则**」（如 3 座），再「**主管复核**」；或「**临时增派空车**」（选待命车 V05+赵师傅）生成接驳班次；
   - 直接派班 V06 或选李海燕，观察**多重阻断原因**；用 V01+王建国派班成功后，在留座规则下最多只能卖到 11/14（可在东门站务页检票观察第 12 张被留座拦截）；
   - 「天气与管制」里把预警改成等级 3（暴雨橙色）→ 出现**一键停运**；
   - 包车页代客登记 18 人+2 轮椅团队，先配小车被拒、再配 V05 成功。
4. **触发一次全新跳站**：司机页选陈志强+V02，让站务把 `TR…-001` 在东门检票卖满（队列不够可先多买几张东门票），再用「到站」选百花园 → 弹出**满载跳站解释**（记录号+下一班 ETA）。
5. **游客页**：查询被跳站游客票号（如百花园新票），点「对本次跳站有疑问 / 投诉」。
6. **客服页**：在「**满载跳站投诉**」标签查看同一 `SR` 记录（含车内人数、站点确认、调度处置），点「办结投诉」选补偿方式；回到游客页可见客服回复。
7. **客服页**：处理退票（同意/驳回/升级主管），在「主管争议裁决」完成终局裁决。
8. **财务页**：对已核准退票单笔「出账退款」。
9. **运营复盘页**：查看站点等待（含被跳组数）、车辆利用率、投诉原因（满载跳站）、退票成本四张图表与 KPI。

### 自动化验证（后端端到端，73 项断言）

全新种子库启动后端后另开终端：

```bash
rm -f server/data/app.sqlite
(cd server && npm start &)          # 等待 API 就绪
node server/scripts/scenario-check.mjs
# 输出 73 通过 / 0 失败（ALL_SCENARIOS_PASSED）
```

该脚本覆盖：优先检票、始发站校验、**满载跳站解释自动生成（原因/车内人数/下一班ETA/补偿/换乘）、站点负责人确认、留座规则检票锁定、临时增派空车、调度主管复核、游客投诉→客服同记录办结**、派班多重阻断、安检不合格转维保、反方向拦截、车辆故障、退票核准→财务出账、争议升级主管裁决、暴雨停运与派班阻断、交班延误、包车座位/轮椅校验、广播限流、车票时间线、复盘报表。

> 本轮开发中已实际执行：`tsc --noEmit`（前后端均通过）、`vite build`（通过）、`scenario-check.mjs`（73/73 通过）、以及 `node dist/main.js` 以容器同款方式启动冒烟（通过）。Docker Compose 配置已提供，当前沙箱未安装 Docker，未在本地执行镜像构建。

---

## 五、切换 MySQL（可选）

默认 SQLite 零配置运行。如需使用 MySQL（8.x），先建库：

```sql
CREATE DATABASE scenic_shuttle DEFAULT CHARACTER SET utf8mb4;
```

然后用环境变量启动后端（`synchronize: true` 会自动建表）：

```bash
cd server
DB_TYPE=mysql DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=root DB_NAME=scenic_shuttle \
  npm start
```

---

## 六、主要接口一览（前缀 `/api`）

- 票务：`POST /tickets`、`GET /tickets/:id`（含票的完整事件时间线与跳站解释）、`GET /tickets/code/:code`、`POST /tickets/:id/refund`
- 站点：`GET /overview`、`GET /routes`、`GET /stations/:id/board`（含 `skipRecords`、`seatReserve`、班车 `downstreamReserve/sellable`）、`POST /stations/:id/enqueue`、`POST /stations/:id/board-next`、`POST /queue/:id/board`、`POST /queue/:id/dispute`、`POST /broadcasts`、`PATCH /stations/:id`
- 调度：`GET /dispatch/dashboard`（含 `skipRecords`）、`POST /trips`、`POST /trips/:id/start-boarding|arrive|leave|complete`、`POST /safety-checks`、`POST /vehicles/:id/fault|charge|repair`、`POST /drivers/:id/duty|handover-delay`、`POST /weather`、`POST /road-controls`、`POST /dispatch/storm-suspend|resume`、`GET /geofence-events`、`POST /charters`、`POST /charters/:id/assign|status`
- **满载跳站**：`GET /skip-records`（支持 `stationId/status/complaint` 过滤）、`GET /skip-records/open`、`GET /skip-records/by-ticket/:ticketId`、`GET /skip-records/:id`、`POST /skip-records/station/:stationId/manual`、`POST /skip-records/:id/station-confirm|requeue|waiting-policy`、`POST /skip-records/:id/dispatch-extra-vehicle|seat-reserve|dispatch-review|close`、`POST /skip-records/:id/complaint|complaint/handle`
- 客服/财务：`GET /service/workbench`（含 `skipComplaints`）、`POST /refunds/:id/approve|reject|escalate|supervisor-decide|pay`、`POST /incidents/:id/take|resolve`、`GET /incidents`
- 复盘：`GET /ops/report`

## 七、目录结构

```
docker-compose.yml        一键启动（server API + web Nginx）
server/                   NestJS 后端
  Dockerfile
  src/
    entities.ts           16 张表：线路/站点/车辆/司机/安检/班次/车票/排队/事件/退票/广播/天气/管制/围栏/跳站记录/包车
    skip-records/         满载跳站解释（站务确认/调度增派空车/留座规则/主管复核/客服投诉）
    tickets/ stations/ dispatch/ service/ ops/ incidents/
    seed.service.ts       演示种子数据（含 1 条跳站记录）
  scripts/scenario-check.mjs  端到端校验（73 项断言）
web/                      React 前端
  Dockerfile  nginx.conf
  src/pages/              7 个角色工作台
  src/components/SkipShared.tsx  四端共用的跳站记录展示组件
```
