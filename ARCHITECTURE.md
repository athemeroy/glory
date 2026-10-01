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
- `mobiletest.py URL`：真实多点触摸、摇杆与技能、长按 / 松手、镜前换装、暂停 / 恢复、横竖屏与安全区域、键鼠回归、联机来宾输入；手动推进模拟和渲染。可用 `--metal`（Mini）或 `--cdp URL` 复用支持 WebGL 的 Chromium。
- `modelqa.py --serve --cdp URL --output DIR`：真实 15 个绑定模型的正面、侧面、握持近景与第一人称截图，记录脚底连续采样、蒙皮边伸缩、骨权重与握持可达性；`--check-pages` 可执行下列自检页，`--app-check` 检查默认模型加载路径。GPU 批量截图在 Mini 上跑。
- `anim-regression.html`：被打断的交叉淡入、髋高与动作缓存、职业上身姿态和脚底接地；`griptest.html` / `iktest.html`：真实双手武器握持、不可达目标回退、骨长保持与缩放父节点。
- `cloth-test.html` / `attachment-test.html` / `garment-test.html`：已确认披风、挂布、外袍与头饰错绑的五类动作变形、人体/非目标区域保护、源 GLB 不变与只读修复缓存。`weight-regression.html` 对照每条网格边，避免修好局部裂口却在修复边界生成新的尖刺。`cloth-probe.py` 用 numpy 从 GLB 读取真实绑定位置和权重，辅助定位，不改资产。
- `hud-lifecycle.html` / `mode-lifecycle.html`：角色/队伍重新绑定、目标与飘字清理，以及单机/联机模式退出后取消结算、倒计时和复活；重复联机结束消息只结算一次。
- `fighter-lifecycle.html`：反复换装的旧身体释放、武器保留与共享资产保护。`viewqa.py` / `menuqa.py` / `loadqa.py`：桌面和手机预览加载、拖拽、GPU 资源、菜单帧开销及加载中取消/切换模式。三个 runner 均支持 `--serve --cdp URL --output DIR`。

## 动捕角色（src/game/mocap.js）
- `assets/models/rigged/<clsId>.glb`：Tripo P1 模型经 Meshy 绑骨（24 骨：Hips、Spine/Spine01/Spine02、neck、Head、Left/Right Shoulder/Arm/ForeArm/Hand、UpLeg/Leg/Foot/ToeBase），Armature 缩放 0.01。`manifest.json` 列出可用角色。
- `assets/anim/anims.glb`：70 个动作片段（只含骨架与轨道）。髋骨位移单独保存：只取竖直方向相对站立高度的变化，按“目标模型静止髋高 / 片段站立髋高”缩放后叠加（不同模型骨架单位不同）。
- `MocapAnimator.update(dt, st)` 与程序化 `Animator` 共用同一个状态对象：移动按速度/方向选片段（战斗待机、前后走跑、斜向跑、疾跑）；技能按程序化片段名映射到动捕片段（`ATTACK_MAP`），命中帧由右手/右脚速度峰值自动估计（`analyzeImpacts`），蓄力阶段走到命中帧前、生效阶段越过命中帧；射击类固定在瞄准帧；受击/浮空/倒地/起身/受身/死亡/欢呼各有映射。视线俯仰叠加到 Spine02。
- 共享动作按源骨架与目标骨架的世界绑定朝向重定向四元数，保留目标骨长；同源模型与绑定帧复用只读重定向片段，每个 mixer 的播放时间保持独立。命中帧分析也使用同一映射，左刺拳检查左手。交叉淡入从当前全部有效权重继续，连段中打断过渡不会把中间动作重置为满权重；髋部起伏与旋转共用权重。
- 程序化动画的目标姿态数组与辅助对象按 Animator 实例复用，髋高只读取已调度且有有效权重的动作，未播放的缓存 action 不参与混合。1936 帧旧/新对照姿态最大差为 0；Mini 纯 CPU 基准的中位动画计算开销下降约 4–8%，不代表整局渲染帧率。
- 地面待机/移动/格挡从实际脚底蒙皮顶点取最多 18 个代表点补偿髋高，按目标腿高限制补偿范围；攻击、跳跃、受击、闪避时退出并归零。`StanceArms` 让枪械、双手重武器、拳套与法器站/跑使用职业程序化上身姿势，下盘保留动捕；枪械开火维持瞄准，近战技能与受击使用完整动捕。
- `createMocapBody` 按 `gloryClass` 执行服饰修复，游戏、选角预览和第一人称共用入口。`cloth.js` 修复已审计狂剑士/骸骨卫兵披风、裙摆的错误肢体权重；`attachment.js` 按焊接三角拓扑识别骸骨头饰、狂剑士 294 顶点前腰挂布、术士 855 顶点中央袍片及霜法师外袍下摆。霜法师整片 2647 顶点真实腿脚和腰线以上头袖完全保护。贴近腿骨的袍料仍属于衣饰，不能只按到骨骼的距离认作真实小腿。新蒙皮属性与几何按源模型缓存，原始 GLB 与位置/法线/UV 均不改；未审计区域仍可能有错绑，不做全身笼统重绑。
- `tools/rigtest.html`：检查全部 15 个角色的绑定姿态恢复、5 类动作的旋转与骨长、髋部切换连续性以及源动作不被修改；同时验证握持中心、武器位置、手腕扭转和网格拆分。启动本地静态服务器后打开此页，结果保存在 `window.__results` / `window.__errors`。
- 武器挂到 `RightHand`/`LeftHand`：绕 X -90°，再绕 Z 30°（法杖类 95°），缩放抵消骨骼 0.01。握持中心由绑定姿态中手骨权重大于 0.5 的顶点加权估计（`handSocket`），预览与游戏共用 `mountMocapWeapon`。
- 本地玩家第一人称：世界身体按主导骨骼拆出 head / arms（`splitForFirstPerson`），分别进 `rig.headParts`、`rig.armParts` 隐藏；分区共享只读顶点属性，仅创建各自的三角形索引，保留原网格变换；身体材质加只对主相机生效的胸口裁切面。
- 第一人称手臂层（`fpview.js`）：再克隆一份绑骨模型，只留手臂网格（去掉 Shoulder 主导的肩甲）。程序化骨骼照常由 `Animator` 驱动但隐藏，只作姿态源；每帧 `retarget()` 把胸口扭转按世界增量复制到 Spine02，再让 Arm→ForeArm→Hand 各段朝向对齐程序化骨段（最小旋转）。手掌旋转通过绑定姿态坐标轴映射完整复制程序化手腕旋转，保留旋前/旋后；武器朝向沿用程序化握把，位置移到模型的握持中心。手臂材质 `nearFade`：离镜头 0.42m 内丢弃，随后 2.5cm 抖动过渡，减少袖口颗粒面积。视图模型宽屏固定 60° 竖直视野，窄屏保留至少 62° 水平取景，让炮、矛与双枪的握持双手留在画面内；世界视野与瞄准缩放独立。
- `grip.js`：移除精模原本张开的手部三角形，世界与第一人称使用带 14 个指节骨和一个掌骨的握持手；掌/指合为一个 SkinnedMesh、两个材质组，腕部单独连接原袖口。颜色从原手部贴图取样并缓存。双手重剑/矛/炮使用 `ik.js` 双关节 IK，只转骨骼、不拉长手臂；目标不可达时保留原动作。双枪左右分开、枪管水平朝前；炮管与下方细握柄分离。
- `disposeRig` 释放实例几何、材质和骨纹理，保护预加载 GLB、程序化缓存及共享顶点属性；换装先拆下保留的武器。预览资源延迟到达或外观变化会刷新同职业模型，手机预览限 30fps、DPR 1.25，离屏或后台停止绘制。手机菜单不启动背景 AI 对战，暂停画面仅在状态变化时绘制；模式加载带取消代次，旧回调不能启动已退出的战斗。
- `mode-timers.js` 统一管理单机/联机模式的延迟任务，退出时取消，并在执行前核对当前模式；旧结算不能覆盖新局。`HUD.resetBattle()` 清理旧玩家、队伍、准星目标、飘字、名牌和受击/结算遮罩；重新绑定相同队伍也重建队友栏。
- 越肩/第三人称：角色材质带 `game.camFade`（1.25m）近镜头抖动淡出，挡在镜头前的角色不会糊满屏幕；视野乘 0.84。
- 视角：`game.viewMode` 为 fp / ots / tp，F5 循环，设置里可选默认视角。
