import { prepareHeightSlam, trackHeightSlam, landHeightSlam } from '../src/game/slam-height.js';
import { SKILLS } from '../src/data/classes.js';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);}, tests=[];
function test(name,fn){try{fn();tests.push({name,passed:true});}catch(e){tests.push({name,passed:false,error:e.message});}}
function land(start,peak,end){const f={pos:{y:start}},def=prepareHeightSlam(SKILLS.dilie,f),a={def};trackHeightSlam(f,a);f.pos.y=peak;trackHeightSlam(f,a);f.pos.y=end;landHeightSlam(f,a);return a;}
test('ordinary skills preserve reference and existing metadata',()=>assert(prepareHeightSlam(SKILLS.bengshan,{pos:{y:3}})===SKILLS.bengshan,'other skill copied'));
test('height skill clones damage values per cast',()=>{const a=land(0,3,0);assert(a.def!==SKILLS.dilie&&a.def.hits[0]!==SKILLS.dilie.hits[0]&&SKILLS.dilie.hits[0].dmg===110,'global skill mutated');});
test('three metres increases both damage and radius',()=>{const ground=land(0,0,0),high=land(3,3,0);assert(high.def.hits[0].dmg>ground.def.hits[0].dmg&&high.def.hits[0].range>ground.def.hits[0].range,'height has no effect');});
test('raised platform uses landing elevation',()=>{const a=land(4,4,3);assert(a.slamDrop===1&&a.def.hits[0].dmg===125,'absolute altitude used as drop');});
test('max actual height caps damage and radius',()=>{const a=land(100,100,0),b=land(6,6,0);assert(a.slamDrop===6&&a.def.hits[0].dmg===b.def.hits[0].dmg&&a.def.hits[0].range<=4.3,'unbounded cliff multiplier');});
test('landing applies exactly once',()=>{const a=land(4,4,0),damage=a.def.hits[0].dmg;landHeightSlam({pos:{y:0}},a);assert(a.def.hits[0].dmg===damage,'double scaling');});
test('skill is ground impact and has no old traveling sword wave',()=>assert(SKILLS.dilie.slamOnLand&&SKILLS.dilie.groundOnlyLeap&&!SKILLS.dilie.proj,'old projectile remains'));
test('tiger skill is controllable fist and foot sequence without forced dash',()=>assert(SKILLS.menghu.name==='猛虎乱舞'&&SKILLS.menghu.moveOk&&!SKILLS.menghu.dash&&SKILLS.menghu.altAnims.includes('kick')&&!SKILLS.menghu.armor,'autopilot or automatic armor remains'));
const result={passed:tests.filter(t=>t.passed).length,total:tests.length,tests};console.log(JSON.stringify(result,null,2));if(result.passed!==result.total)process.exitCode=1;
