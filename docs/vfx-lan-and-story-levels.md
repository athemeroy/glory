# 特效、局域网表现与剧情地图验收

本轮使用仓库里的 Three.js 与 Mini Chrome Metal，通过 `http://192.168.31.6:8780` 访问开发服。技能数值、状态与命中来自游戏数据；`skill-visuals.js` 是原创美术表达，特效没有追加伤害范围。

## 特效接口与约束

`src/game/vfx.js` 暴露以下事件，Game 与 Combat 负责在实际事件发生时调用：

| 接口 | 表现 |
| --- | --- |
| `skillEvent(f,type,data)` | 起手、攻击段、落地、增益、变形、遮影步 |
| `fire(owner,p,def,pos,dir)` | 实际枪口、施法出口、投沙起点 |
| `projectileMesh(kind,color,def,p,owner)` | 子弹、炮弹、针、砖、刀、药瓶、符文实体 |
| `projectileStep(projectile,dt)` | 随速度/年龄转动、短轨迹和尘云 |
| `areaEvent(owner,area,def,pos,tick)` | 实际半径的地面区域、雨、火、烟、召唤、卫星 |
| `explosionEvent(owner,pos,explosion,def)` | 已经过 Combat 数值缩放的爆炸半径 |
| `channelBeam(owner,def,from,to,width,duration)` | 有真实起止点的激光/吸取 |
| `healTarget(target,heal,source)` | 目标治疗、净化、护盾 |
| `statusTarget(target,effect)` | 跟随活体状态的低遮挡标记 |
| `blinkTrail(f,from,to)` | 位移前后短暂残影 |

返回 `true` 表示取代旧特效，避免重复绘制。`fire` 只是附加表现；声音仍由 Game 触发。持续状态按角色与状态类型复用一个显示对象，跟随 `fighter.effects` 消失、死亡或到期而删除。连续区域复用相同实例；粒子、几何、材质均按生命周期或共享缓存处理。

桌面上限为 112 个效果对象、320 个 drawable、900 个池化粒子；触摸设备为 72 个效果对象、180 个 drawable。极端压力优先回收旧表现，不影响战斗逻辑。普通斩击没有额外飞行剑气，剑光不会随威力扩大射程；近战弧、拳脚与方向技能跟随两端角色当前 `yaw/pitch` 和实际骨架，允许半招转身。投射与激光使用 Combat 提供的实际出口与方向；不会因角色之后转身而改变已发射实体的轨迹。

## 局域网修复

客机按同一 60ms 姿态缓冲重放事件，避免特效先于人物动作。投射快照携带所有技能载荷、形状、所有者、速度与年龄；连续区域、预警、状态可从快照恢复。双方技能配置在生成角色时应用，保留模型和动画的原有配置。每端自己绘制投射轨迹和延迟首击时间线，主机不再把内部轨迹粒子或延迟回调产生的剑光/火星重复录成可靠消息。

`NetGuestDuel.replayErrors` 保留最多 20 条表现重放错误用于排查。清场会清除投射、待重放事件、持续区域索引与快照；VFX 清场同时取消延迟显示和清空粒子可见尺寸。

## 地图接口

`clocktower`（钟楼旧街）包含绕过实体钟楼的两条街道、西侧 2.4m 高廊、两端 .3m/级的阶梯、1.2m 北门平台和街道掩体。可行走主线存在 `markers.route`。

`frostbridge`（霜溪古桥）包含 1.8m 主桥、.6m 西桥、两岸掩体、河岸栏杆与 .3m/级的阶梯。河中央的基础地面为 -30m，桥面依靠真实 collider 承托。跌河会按 Fighter 的跌落死亡机制处理；主线和侧线分别存在 `markers.route` / `markers.alternateRoute`。

| 地图 | waypoint | encounter | exit |
| --- | --- | --- | --- |
| clocktower | `[-10,2.4,4]` | `[0,0,-12]` | `[0,1.2,-21]` |
| frostbridge | `[0,1.8,-4]` | `[0,0,-18]` | `[0,0,-27]` |

两图均有 `player/enemy/teamA/teamB` 出生点、明确 bounds、合并静态网格、材质与几何清场。低画质保留同样的碰撞布局。

## 已完成的证据

- 全职业 GPU 采样：112 组普攻/技能，包括 12 个可玩职业、3 个 PvE 模型、所有新增可选技能，浏览器错误 0，矩阵均有限值。
- 500 次效果压力采样：107/112 个对象、320/320 个 drawable、335/900 个粒子。8 秒后对象/图元/粒子全 0；GPU 几何 39→39、贴图 3→3。
- VFX CPU 回归 12 项：两端斜向剑光一致；半招转身跟随当前姿态；状态刷新复用；净化和死亡清除状态显示；掌击和抓取跟随实际左右手；旋风左脚/低扫右脚；流氓混合踢腿、散人掌击阶段与实体左盾的 socket；延迟首击按真实 hit 时间显示且取消/晚到不会重复等待；LAN 内部延迟回调不重复录制、外部真实事件仍录制且离房恢复方法；区域连续 tick 去重；更新时追加效果仍受预算约束；清场阻止延迟事件。
- 最终真实 LAN：4 个房间、14 个技能样本，含投沙/砖/毒针/刀、混乱雨/影焰/圣锤/净化/圣诫、催眠/烟雾、冰瓶/藤蔓/炮弹；体力与 6 类持续状态同步，净化/离房清场，浏览器错误 0。钟楼和霜桥在真实房间菜单选图，双端加载同一个地图。客机暂停 1.6 秒、错过激活事件后，持续雨区域从快照恢复为 1 份，待重放队列归 0，重放错误 0。
- 两图 CPU 与 Mini GPU 回归：钟楼 11 段主线、霜桥 7 段主线与 5 段侧线均能由真实 World 解算步行通过。6 个掩体挡低射线但不挡头顶射线；出生点落在真实地面；77/73 个 collider 有效；静态资源清场分别 57/57 与 42/42。
- 两图 GPU 保存 12 个高/低画质视图，浏览器错误 0；约 63–85 次绘制（含阴影）与 3.4–5.1 万三角。共有 Kit 的太阳阴影 render target 已纳入所有权：两图实际 dispose 后几何归 0、贴图从 8 降为 6，剩余 6 张是共享基础贴图。
- 最终优化 GLB 的 9 项真实角色采样：左掌、左拳、旋风左脚、低扫右脚、混合连招踢脚、伞形态左掌、实体左盾、炮师实际枪口与半招转身；对应 socket 与效果位置误差均 < 1e-6m，浏览器错误 0。使用实际动画段定帧，作用是验收位置与可见范围，完整技能接触由 Combat 的实际动作矩阵另行验证。
- 最终 LAN 时间线专项：1 个实际房间，流氓延迟扫腿在客机仅生成 1 次 burst，协议中额外 `V.burst/V.slash` 为 0；客机暂停 1.6 秒后混乱雨恢复 `zone=1/pending=0/replayErrors=0`；双方实际离房后角色/效果/粒子均 0。
- 最终生产 RAF 性能 8 场景：Apple M4 / Chrome ANGLE Metal，三张剧情地图各 high/low、最多 4 个实际模型角色；另测训练镜子桌面 high 与模拟手机视口 low 的持续格挡。实际 render 为 60.1–60.2 FPS，RAF p95 为 16.7–16.8ms，render CPU p95 为 2.2–3.6ms。high 实际像素比 2、low 1.25；自动画质降级关闭，15 个 optimized GLB 均从默认加载请求，无原模型回退；8 次真实 App.quit 清场全 0，浏览器错误 0。

可筛选证据图库在工作区 `../artifacts/all-vfx/index.html`；原始结果与截图在 `../artifacts/all-vfx/{final,net-final,net-timeline-final,sockets-final}`、`../artifacts/story-levels`、`../artifacts/live-performance`。特效图库使用简单体积人偶来观察遮挡与范围；角色与技能的真实联机检查使用游戏页。

性能是 Mini 上每场景 5 秒的暖机渲染采样，包含实际 AI、后期、阴影与镜子，不包含初次下载/启动耗时；手机样本模拟了触控视口与 DPR，并非手机硬件帧率。训练场包含玩家与 3 个正常程序化木桩，剧情样本的 4 个角色均使用优化动捕模型。

## 复跑

```sh
node --experimental-loader ./tools/three-local-loader.mjs tools/vfx-regression.mjs
node --experimental-loader ./tools/three-local-loader.mjs tools/story-level-regression.mjs
```

Mini 上使用已有 Playwright 环境，保持开发服运行：

```sh
~/glory-test/venv/bin/python /tmp/check-all-vfx.py http://192.168.31.6:8780 /tmp/glory-vfx-final
~/glory-test/venv/bin/python /tmp/check-net-vfx.py http://192.168.31.6:8780 /tmp/glory-net-vfx-final
~/glory-test/venv/bin/python /tmp/check-story-levels.py http://192.168.31.6:8780 /tmp/glory-story-levels
~/glory-test/venv/bin/python /tmp/check-live-performance.py http://192.168.31.6:8780 /tmp/glory-live-performance
~/glory-test/venv/bin/python /tmp/check-vfx-sockets.py http://192.168.31.6:8780 /tmp/glory-vfx-sockets-final
~/glory-test/venv/bin/python /tmp/check-net-vfx-timeline.py http://192.168.31.6:8780 /tmp/glory-net-timeline-final
```

最后一项使用生产 RAF、真实模拟和真实渲染，报告实际 render FPS、RAF 帧时、render/tick CPU 时长、DPR 与资源；不使用手动模拟帧率作为性能结论。
