# 拳脚操作与地裂斩高差

原著核对：2026-10-03。

- [第1120章《换号》](https://cn.ttkan.co/novel/pagea/quanzhigaoshou-hudielan_1120.html)写明猛虎乱舞是施放后可控的连续拳脚攻击，目标能够通过拉开距离脱出。
- [第1540章《无需安慰》](https://cn.ttkan.co/novel/pagea/quanzhigaoshou-hudielan_1541.html)强调持续控制和对手应对决定能否打满。
- [第1266章《第七赛季的两位新秀》](https://cn.ttkan.co/novel/pagea/quanzhigaoshou-hudielan_1266.html)出现连续招式转向压制不同对手的用法。
- [第1509章《就差一步的功亏一篑》](https://cn.ttkan.co/novel/pagea/quanzhigaoshou-hudielan_1510.html)中先开钢筋铁骨，再用猛虎乱舞；未将钢筋铁骨的霸体当成猛虎乱舞天然自带的属性。
- [第484章《各有布置》](https://cn.ttkan.co/novel/pagea/quanzhigaoshou-hudielan_484.html)明确狂剑士地裂斩从房顶落下时扩大伤害和冲击范围，落地后的地面冲击波可以被走位避开。

本轮将拳法家原有“猛虎硬爬山”更正为猛虎乱舞，并把自动向前冲刺改成玩家持续移动、转向的拳脚连击。每段仍按当下真实拳脚轨迹判定；转错方向、距离不够或被击断会损失后续命中。八段/1120毫秒及伤害是本作配置，未照搬同人中“多少拳纪录”等说法。

首轮36场AI对抗还发现了一项能力失用：AI在任何攻击的活动段都停止移动和转向，因而没有使用猛虎乱舞已有的可控移动。现已让`moveOk`招式沿用正常追近、转向及避障；不允许移动的攻击继续保持原限制。这是AI使用方式的修复，没有因此提高拳脚伤害或放大命中体积。

狂剑士“地裂波动剑”原先是一发贴地远程剑气，现在替换为地裂斩：地面起手短跳，空中起手直接继续下落；真实落地才产生一次冲击。每次施放单独记录最高脚部高度，减去实际落地点高度计算落差。落差每米增加0.35米半径和14%伤害，最多计算6米；因此在高台原地落回高台不会白赚楼层高度，悬崖也不会无限增幅。画出的地裂半径与实际判定读取同一个当前施放数据。

本作当前未添加地裂斩概率眩晕，而使用明确的短僵直、击退和倒地；并未将这个取舍称为小说原始数值。击中仍须满足三维高度和遮挡，地面冲击不能击中高空或穿墙目标。

代码：`src/game/slam-height.js`、`src/game/fighter.js`的四个局部调用、`src/data/classes.js`、`src/data/skill-visuals.js`。回归：`tools/slam-height-regression.mjs`和`tools/check-height-skills.py`。
