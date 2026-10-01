# 荣耀 Web 版 · 架构约定

浏览器原生 ES Modules，无构建步骤。`index.html` 用 import map 把 `three` 指向 `./vendor/three.module.js`（three r186）。
本地运行：`python3 -m http.server 8765` 后打开 `http://localhost:8765/`（或 `tools/serve.sh`）。

## 目录
- `vendor/`：three.module.js、three.core.js、Reflector.js（已打补丁：`reflectLayers`、`maxDistance`、`enabled`）。
- `assets/img`（菜单/加载背景）、`assets/portraits`（职业三视图，640 宽，左 1/3 是正面）、`assets/tex`（可平铺材质：stone wood iron cloth leather bronze，1024²）。
- `src/engine/`：input、audio、渲染与工具。
- `src/game/`：角色模型/动画、战斗、AI、关卡、特效、模式。
- `src/data/`：职业、技能、账号卡。
- `src/ui/`：HUD、菜单（DOM 叠层）。

## 坐标与单位
- 米、秒（战斗数据里的时间用毫秒）。Y 轴向上，地面 y=0。
- 角色模型朝向本地 +Z；`model.rotation.y = yaw`，前方向量 `(sin yaw, 0, cos yaw)`。
- 角色身高约 1.75m，眼高 1.62m，碰撞为竖直胶囊，半径 0.4m、高 1.8m。

## 图层（THREE.Layers）
- 0：一切默认。
- 1：本地玩家的头部/头发（主相机不渲染，镜子渲染）。
- 2：仅主相机（屏幕空间辅助，如准星附近的提示）。镜子不渲染。
- 镜子 `reflector.reflectLayers = (1<<0)|(1<<1)`。

## 关卡接口（src/game/levels.js）
```js
export function buildLevel(id, ctx) // ctx = { THREE, renderer, tex(name) -> THREE.Texture(已设 repeat wrapping, sRGB), quality: 'high'|'low' }
// 返回：
{
  id, name,
  group,                 // THREE.Group，调用方 scene.add(group)
  colliders: [ {min:[x,y,z], max:[x,y,z], tag?:'wall'|'platform'|'pillar'} ], // 轴对齐实体盒；盒顶可站立
  bounds: {minX, maxX, minZ, maxZ},     // 硬边界（空气墙）
  spawns: { player:[x,y,z,yaw], enemy:[x,y,z,yaw], ... },  // 各关卡自定义命名
  markers: { ... },                     // 例如 dummies:[[x,z,yaw]...]、mirror:{pos:[x,y,z], normal:[x,y,z]}、bossCenter:[x,z]
  sun,                    // 主方向光（castShadow），调用方会让阴影相机跟随玩家
  background, fog,        // 调用方赋给 scene.background / scene.fog
  mirrors: [Reflector...],// 训练室镜子（Reflector 实例，已设 reflectLayers）
  update(dt, t),          // 动画（旗帜、火焰、光斑等），可为空函数
  dispose()
}
```
关卡 id：`training`（镜廊训练室）、`courtyard`（断桥庭院，1v1）、`coldiron`（寒铁遗庭副本：入口通道+Boss 圆场）、`arena`（联赛赛场，擂台/团队赛）。

## 音频接口（src/engine/audio.js）
```js
export const audio = {
  init(),                          // 首次用户手势时调用，创建 AudioContext
  setListener(x, y, z, yaw),       // 每帧
  play(name, {pos:[x,y,z]?, vol=1, rate=1}?), // 有 pos 走 3D 声像（HRTF/equalpower）
  loop(name, opts) -> handle{stop()},
  music(on:boolean),               // 菜单氛围音乐（战斗中不放背景音乐，原著设定）
  setVolume(master, sfx, music)
}
```
全部声音用 WebAudio 实时合成（无外部音频文件）。

## 战斗核心（src/game/fighter.js, combat.js）
Fighter 状态：`idle move attack guard hitstun air down getup dead stun`。
受击效果：`stun`（硬直 ms）、`knock`（击退 m）、`launch`（浮空初速 m/s）、`down`（击倒）、`pull`。
浮空保护：同一连段累计浮空 >2s 或第 3 次挑空后不能再挑空；连段伤害从第 2 段起递减，最低 0.45。
倒地时按 Space 受身（落地前后 250ms 窗口）。

## 渲染管线（src/game/post.js）
EffectComposer：主画面 RenderPass → 第一人称手臂层 OverlayPass（清深度、不画背景）→ 数值清洗（NaN/Inf 置零）→ UnrealBloom（阈值 1.3，只对 HDR 高光）→ 调色（暗角、受击泛红与色差、饱和度、颗粒）→ OutputPass（ACES + sRGB）→ SMAA。设置里可关后期；帧率持续低于 40 自动降档。

## 原画精模（src/game/skin.js）
`assets/models/<clsId>.glb` 为概念图经 Hunyuan3D 图生 3D 的带贴图网格（Y 上、面朝 +Z、身高 1.76、A 字姿势）。`assets/models/manifest.json` 列出可用模型（`tools/make-manifest.sh` 生成）。
启动时预加载；`skinToRig` 直接用 rig 的骨骼节点作骨架，按 A 字角度绑定，按到骨段距离算权重（结果按模型+体型缓存），并按主导骨骼拆成 head / arms / body 三个 SkinnedMesh：head 进 `rig.headParts`（第一人称隐藏）、arms 进 `rig.armParts`（第一人称隐藏，由手臂层替代）。第一人称手臂层同样蒙皮同一模型，只显示 arms。换装面板可切回程序化“自定义配色”（`look.proc = true`）。

## 联机（src/engine/p2p.js、src/game/netmodes.js、server/sig-core.mjs）
浏览器直连：`net`（net.js 导出的 P2PNet 单例）用一条可靠有序的 WebRTC 数据通道收发 JSON，接口与旧 WebSocket 版相同（on/emit、relay、leave，事件 peer/joined/left/close/relay/error，字段 rtt/connected/peerGone）。
牵线不用 trickle ICE：候选地址收集完（最多 3.5 秒）才出码。连接码只保留 ice-ufrag/pwd、DTLS 指纹、setup 与最多 6 个 host/srflx 候选，JSON 后 base64url，前缀 `G1`，约 300 字符；对方按固定模板还原 SDP。STUN 用国内可达的 B 站、hitv，以及 Cloudflare、Google。
房间号：`POST /api/sig`（op=new/get/answer/poll），只保存连接码 15 分钟。密码在客户端做哈希（不用 crypto.subtle，http 局域网下不可用），房主连上后再核对一次。
主机权威：`NetHostDuel` 接收客机输入，每 33ms 发快照与表现层事件；`NetGuestDuel` 插值显示并重放事件（胜负相关文案与语音自动翻转）。

## 语音（src/engine/voice.js）
`assets/voice/*.mp3`：Mini 上 macOS 神经语音（婷婷/Reed）合成的解说与大招喊招。

## 测试工具（tools/）
- `pwrun.py`（NMB，swiftshader）/`pwrun_gpu.py`（Mini，Metal）：实时跑一局，`?auto=<mode>&bot=1&dump=1&speed=N&rskip=N`。
- `fpseq.py`、`tour.py`：`?manual=1` 下用 `game.debugAdvance(sec)` 确定性推进并截图（tour 在 Mini 真 GPU 1080p 跑）。
- `balance.py`：12 账号两两对战矩阵（Mini 上 6 页并行，约 10 分钟）。
- `nettest.py`：两页联机冒烟测试。`skin-test.html`：精模蒙皮姿势检查。`model-preview.html`：程序化姿势三视图。

## 动捕角色（src/game/mocap.js）
- `assets/models/rigged/<clsId>.glb`：Tripo P1 模型经 Meshy 绑骨（24 骨：Hips、Spine/Spine01/Spine02、neck、Head、Left/Right Shoulder/Arm/ForeArm/Hand、UpLeg/Leg/Foot/ToeBase），Armature 缩放 0.01。`manifest.json` 列出可用角色。
- `assets/anim/anims.glb`：70 个动作片段（只含骨架与轨道）。加载时去掉缩放轨道，髋骨位移单独保存：只取竖直方向相对站立高度的变化，按“目标模型静止髋高 / 片段站立髋高”缩放后叠加（不同模型骨架单位不同）。
- `MocapAnimator.update(dt, st)` 与程序化 `Animator` 共用同一个状态对象：移动按速度/方向选片段（战斗待机、前后走跑、斜向跑、疾跑）；技能按程序化片段名映射到动捕片段（`ATTACK_MAP`），命中帧由右手/右脚速度峰值自动估计（`analyzeImpacts`），蓄力阶段走到命中帧前、生效阶段越过命中帧；射击类固定在瞄准帧；受击/浮空/倒地/起身/受身/死亡/欢呼各有映射。视线俯仰叠加到 Spine02。
- 武器挂到 `RightHand`/`LeftHand`：绕 X -90°，再绕 Z 30°（法杖类 95°），缩放抵消骨骼 0.01。
- 本地玩家第一人称：世界身体按主导骨骼拆出 head / arms（`splitForFirstPerson`），分别进 `rig.headParts`、`rig.armParts` 隐藏；身体材质加只对主相机生效的胸口裁切面。
- 第一人称手臂层（`fpview.js`）：再克隆一份绑骨模型，只留手臂网格（去掉 Shoulder 主导的肩甲）。程序化骨骼照常由 `Animator` 驱动但隐藏，只作姿态源；每帧 `retarget()` 把胸口扭转按世界增量复制到 Spine02，再让 Arm→ForeArm→Hand 各段朝向对齐程序化骨段（最小旋转）。武器朝向沿用程序化握把，位置移到模型手心。手臂材质 `nearFade`：离镜头 0.42m 内的片元抖动丢弃。
- 越肩/第三人称：角色材质带 `game.camFade`（1.25m）近镜头抖动淡出，挡在镜头前的角色不会糊满屏幕；视野乘 0.84。
- 视角：`game.viewMode` 为 fp / ots / tp，F5 循环，设置里可选默认视角。
