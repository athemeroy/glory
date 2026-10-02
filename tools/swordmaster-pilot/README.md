# 剑客设计图样板

本地服务器 `node server/server.mjs` 启动后：

- 游戏样板：<http://192.168.31.6:8780/index.html?auto=training&acc=yysf&swordpilot=1&view=tp>
- 同机位模型对比：<http://192.168.31.6:8780/tools/swordmaster-pilot/compare.html>
- 当前默认版本：<http://192.168.31.6:8780/index.html?auto=training&acc=yysf&view=tp>

样板由 `swordpilot=1` 启用。独立模型 `assets/models/pilot/swordmaster.glb`、
独立动作 `assets/anim/swordmaster-pilot.json`；当前默认模型和共享 Meshy 动作库继续作为对比来源。

普通攻击依次为上撩、反手横扫、过顶下劈，分别使用 Kimodo 生成的全身动作，
第一人称直接显示世界模型的手臂与武器，和镜子共享网格、骨骼和动作。前摇/生效/收招分别为
170/110/240、180/130/280、300/130/420 毫秒。伤害、命中范围、击退沿用原普通攻击。
剑客“三段斩”使用横扫、下劈、上撩，保留原突进、消耗、冷却与末段挑空。
这次改变了普通攻击节奏，仍需要实战平衡评估。

## 资产来源与处理

原设计图：`glory-production/output/imagegen/char-swordmaster.png`。
小鲸编辑脚本：同级制作包的 `generate_swordmaster_pilot.py`；
请求模型 `gpt-image-2.5-sunburst-reverse`，通过现有 default key 读取函数调用。
最终参考图、提示词与回执在 `glory-production/output/swordmaster-pilot/`。
第二次宽 A-pose 请求发生断连，完成/计费未知，回执保留，没有自动重试。

模型在 4090 上经 TRELLIS.2 的 `1536_cascade` 管线生成，100000 面简化目标，
4096 贴图。实际导出面数和尺寸见 `artifacts/swordmaster-pilot/model-metadata.json`。
Blender 先把原 P1 权重来源模型的手臂适配到浅 A-pose，转移蒙皮后焊接接缝，
进行 8 轮、0.5 系数权重平滑，限制每点四个影响。沿用标准 24 骨。

生成网格存在手套与衣摆的错误连接。`separate-hand-fusions.py` 通过源文件哈希认证，
在手套/衣摆接触区域剔除竞争的手臂/下肢影响，移除两类之间的桥接面；
最终修改 652 个顶点权重，移除 63 个面，保留 92750 个三角面。
这属于局部网格清理，脸部、手指和衣料仍是生成模型，尚未经过完整人工雕刻、
专用低模拓扑或布料模拟。

三个全身动作的原始 NPZ、SOMA 77 关节中性姿势位于
`artifacts/swordmaster-pilot/motions/`。`retarget-motions.py` 通过中性骨段方向映射到
原动作库的世界坐标轴，再求父节点局部旋转；保留相对髋高，水平位移由游戏物理控制。
导出的四元数归一化并保持符号连续。运行时继续使用现有绑定轴重定向与脚底支撑。

## 复现与验证

重计算在 4090，实际 WebGL 验证与视频录制在 Mini。Windows 启动脚本中路径为
已有环境，不能当作通用安装器。原始中间模型保存在 `artifacts/swordmaster-pilot/`。

```sh
python tools/swordmaster-pilot/retarget-motions.py \
  ../artifacts/swordmaster-pilot/motions assets/anim/anims.glb assets/anim/swordmaster-pilot.json
python tools/swordmaster-pilot/check-model.py http://192.168.31.6:8780 OUTPUT --full
python tools/swordmaster-pilot/check-game.py http://192.168.31.6:8780/index.html OUTPUT
python tools/swordmaster-pilot/check-mirror.py http://192.168.31.6:8780/index.html OUTPUT
python tools/swordmaster-pilot/record-proof.py http://192.168.31.6:8780/index.html OUTPUT --pilot
```

`check-model.py` 检查跑步与三招各 64 个连续姿态的有限蒙皮结果和边拉伸；
`--full` 扫描全部三角面。`check-game.py` 验证普通攻击实际播放三个不同全身片段，
三段斩仍保留末段挑空，以及 1280×720、390×844、844×390 三种视口的
第一人称、越肩、第三人称布局。手机检查使用浏览器触控视口。

默认/样板视频使用相同机位和触发逻辑；为防连续突进移到墙边，每帧将玩家位置固定在原点。
对比只展示动作与外观，不用于证明真实移动手感或战斗平衡。录制无声。

## 本次验证结果（2026-10-02）

- 完整网格：92750 面 × 64 姿态 × 跑步/上撩/横扫/下劈，均无非有限坐标；
  最大边伸长分别为 6.40、5.87、5.26、6.33 厘米，最大绝对边长均低于 10 厘米。
  这是指定动作范围内的检查，不覆盖所有技能、受击或服饰变化。
- 桌面与手机横/竖屏：三招实际全身片段、三段斩挑空语义、三种视角与横向溢出检查通过。
- 个人赛、擂台赛、团队赛、副本、训练场各 15 秒浏览器冒烟检查无异常；
  该检查验证短时间运行，不代表五种模式全部通关。
- 对比视频：`media/glory-swordmaster-pilot-comparison.mp4`。左列当前默认，右列样板；
  上排第三人称，下排第一人称。完整截图和 JSON 证据在 `artifacts/swordmaster-pilot/`。

## 镜面与第一人称修复（2026-10-02）

默认第一人称直接从主相机渲染世界手臂、身体和武器，不再用另一个 FOV、
相机偏移、缩放或程序化动作改变手的位置；剑光也改用世界武器轨迹。
`fpbody=0` 仅用于旧程序化视图对照。

头、手臂、躯干分区共享只读顶点属性，但各自持有材质；避免躯干的第一人称胸口裁切
传给镜中的头。头只对本地第一人称相机隐藏，镜面与第三人称均保留。
不再根据第一人称视角删除世界手臂三角面。

`check-mirror.py` 在实际 WebGL 绘制回调中对比镜面与主相机的手臂网格 UUID、
索引数量、世界矩阵和骨骼矩阵，并确认镜面绘制头部且不带躯干裁切。
默认/样板桌面、样板手机横竖屏，共 40 个待机/三招采样及 12 次视角切换通过，
无浏览器异常。证据在 `artifacts/swordmaster-pilot/mirror-fix/`。
此前对比视频的第一人称仍是旧程序化视图，不能代表本次修复后的手臂位置。

持续格挡旋转与低清晰度修复：`tools/guard-pose-test.html` 与
`tools/check-guard-quality.py BASE OUTPUT` 验证固定格挡无累计旋转、实际游戏30秒持续格挡、
显示插值与模拟值恢复、画布/后处理尺寸和流畅抗锯齿。55项骨骼回归与3种游戏配置通过。
运行说明：BASE 为服务根地址（如 `http://192.168.31.6:8780`），脚本在带 Chrome、Playwright 的 Mini 环境运行。
证据 `artifacts/guard-quality/`。
