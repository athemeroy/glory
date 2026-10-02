"""Build a local HTML index over untouched GPU screenshots and raw reports."""
import argparse
import html
import json
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('evidence',type=Path);a=p.parse_args()
report=json.loads((a.evidence/'final/results.json').read_text())
names={'unspecialized':'散人','swordmaster':'剑客','battlemage':'战斗法师','striker':'拳法家','sharpshooter':'神枪手','launcher':'枪炮师','warlock':'术士','cleric':'牧师','witch':'魔道学者','berserker':'狂剑士','assassin':'刺客','thug':'流氓','skeleton':'骸骨卫兵','frostcaster':'冰晶术士','boss':'寒铁守卫'}
cards=[]
for sample in report['skills']:
    cls,slot=sample['clsId'],sample['slot'];stem=cls+'-'+slot.replace(':','-')
    label=names[cls]+' · '+(sample['name']or'普通攻击')
    cards.append('<article data-class="'+cls+'"><h2>'+html.escape(label)+'</h2><p>'+html.escape(sample['profile'])+'</p><div class="pair">'+''.join('<a href="final/'+stem+'-'+stage+'.jpg"><img loading="lazy" src="final/'+stem+'-'+stage+'.jpg" alt="'+html.escape(label)+' '+stage+'"><span>'+('起手'if stage=='wind'else'攻击阶段')+'</span></a>'for stage in ['wind','active'])+'</div></article>')
lan=[]
for room in json.loads((a.evidence/'net-final/results.json').read_text()):
    for sample in room['samples']:
        file=f"{room['room']}-{sample['side']}-{sample['slot']}.jpg"
        lan.append('<article><h2>'+html.escape(sample['expected'])+'</h2><p>'+html.escape(room['level']+' · '+sample['side'])+'</p><a href="net-final/'+file+'"><img loading="lazy" src="net-final/'+file+'" alt="真实局域网客机技能截图"></a></article>')
options=''.join('<option value="'+key+'">'+name+'</option>'for key,name in names.items())
final_sections=''
timeline_path=a.evidence/'net-timeline-final/results.json'
if timeline_path.exists():
    final_sections+='<section><h1>最终 LAN · 延迟首击与暂停恢复</h1><p>扫腿客机 burst=1，额外 V.burst/V.slash 协议事件=0；暂停1.6秒恢复雨区域 zone=1/pending=0/errors=0。<a href="net-timeline-final/results.json">原始记录</a></p><div class="grid">'+''.join('<article><h2>'+label+'</h2><a href="net-timeline-final/'+file+'"><img loading="lazy" src="net-timeline-final/'+file+'" alt="最终真实 LAN"></a></article>'for file,label in [('delayed-low-sweep-lan.jpg','扫堂腿 · 延迟首击'),('paused-rain-recovered.jpg','混乱之雨 · 暂停后恢复')])+'</div></section>'
socket_path=a.evidence/'sockets-final/results.json'
if socket_path.exists():
    socket_report=json.loads(socket_path.read_text());socket_cards=[]
    for sample in socket_report['results']:
        label=names[sample['cls']]+' · '+sample['name'];file=sample['cls']+'-'+sample['slot']+'.jpg'
        socket_cards.append('<article><h2>'+html.escape(label)+'</h2><p>'+html.escape(sample['bone'])+' · 骨架与特效位置误差 '+format(sample['nearestEffectError'],'.3g')+' m</p><a href="sockets-final/'+file+'"><img loading="lazy" src="sockets-final/'+file+'" alt="实际 GLB 人物技能"></a></article>')
    socket_cards.append('<article><h2>剑客 · 半招转身</h2><p>剑光跟随当前 yaw / pitch</p><a href="sockets-final/swordmaster-mid-strike-turn.jpg"><img loading="lazy" src="sockets-final/swordmaster-mid-strike-turn.jpg" alt="实际人物半招转身"></a></article>')
    final_sections+='<section><h1>最终优化模型 · 实际手脚与盾面</h1><p>本组使用游戏 GLB 骨架，展示对应动画段的实际 socket；伤害判定仍由 Combat 独立验收。<a href="sockets-final/results.json">原始位置与错误记录</a></p><div class="grid">'+''.join(socket_cards)+'</div></section>'
performance_path=a.evidence.parent/'live-performance/results.json'
if performance_path.exists():
    performance=json.loads(performance_path.read_text());rows=[]
    for r in performance:
        m=r['measurement'];rows.append('<tr><td>'+html.escape(r['case'])+'</td><td>'+format(m['actualRenderFPS'],'.1f')+'</td><td>'+format(m['rafMs']['p95'],'.1f')+'</td><td>'+format(r['setup']['pixelRatio'],'.2g')+'</td></tr>')
    final_sections+='<section><h1>正式渲染循环 · Mini Metal</h1><p>8 个真实 RAF 场景；4 名实际模型人物，显式 high/low，关闭自动画质降级。帧率来自实际 render 次数，包含镜子和后期绘制；不是手动 debugAdvance 的模拟速度。<a href="../live-performance/results.json">完整 CPU / GPU / 资源数据</a></p><table><thead><tr><th>场景</th><th>实际 render FPS</th><th>RAF p95 / ms</th><th>像素比例</th></tr></thead><tbody>'+''.join(rows)+'</tbody></table></section>'
page='''<!doctype html><meta charset="utf-8"><title>全职业特效验收图库</title>
<style>body{margin:0;background:#182027;color:#dde4e7;font:15px system-ui;line-height:1.6}main{max-width:1400px;margin:auto;padding:28px}h1{font-size:26px}h2{font-size:16px;margin:0}p{color:#a6b8bf;margin:6px 0}a{color:#a8d4e3}select{background:#26343d;color:#dde4e7;padding:8px;border:1px solid #526973}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:18px}article{background:#223039;padding:14px;border-radius:6px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;display:block;border-radius:3px}span{font-size:12px}section{margin-top:28px}[hidden]{display:none}</style>
<main><h1>全职业特效验收图库</h1>
<p>112 个全职业技能/普攻样本，另有 4 个真实 LAN 房间的 14 个技能检查。点击图片可打开原尺寸。</p>
<p>特效图库使用简单体积人偶，检查形状、颜色、遮挡与生命周期；下方 LAN 截图来自实际游戏人物。面部、手部、服饰优化和正式帧率单独验收。美术是本作原创表达。</p>
<p>当前帧有方向并不保证攻击命中；伤害、视线、前后朝向和体积始终由 Combat 决定。极端负载会回收最旧特效。部分慢速起手/短暂弹道的单帧照片不能表达完整阶段，可使用游戏中的训练模式或 tools/vfx-check.html 交互重放。</p>
<p><a href="final/results.json">全职业原始结果</a> · <a href="cpu-results.json">最终 socket / 半招转身回归</a> · <a href="net-final/results.json">实际 LAN 结果</a> · <a href="../story-levels/results.json">两图 GPU 结果</a></p>
'''+final_sections+'''<section><h1>实际 LAN · 投射 / 区域 / 治疗</h1><div class="grid">'''+''.join(lan)+'''</div></section>
<section><h1>全职业 · 起手与攻击阶段</h1><select id="filter"><option value="">全部职业与敌人</option>'''+options+'''</select><p id="count">112 个样本</p><div class="grid" id="all">'''+''.join(cards)+'''</div></section></main>
<script>document.querySelector('#filter').onchange=e=>{let count=0;for(const card of document.querySelectorAll('#all article')){card.hidden=!!e.target.value&&card.dataset.class!==e.target.value;if(!card.hidden)count++;}document.querySelector('#count').textContent=count+' 个样本';};</script>'''
(a.evidence/'index.html').write_text(page)
print(json.dumps({'gallery':str(a.evidence/'index.html'),'samples':len(cards),'actualLAN':len(lan)},ensure_ascii=False))
