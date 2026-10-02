"""Convert SOMA global rotations into the existing animation-library rest frame.

Only rotations and relative pelvis height are exported. Fighter physics owns
horizontal movement; source arrays and the shared Meshy library stay untouched.
Requires numpy, scipy and pygltflib. Run with --help for paths.
"""
import argparse
import json
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as R
from pygltflib import GLTF2

MAPPING = dict(Hips='Hips', Spine02='Spine1', Spine01='Spine2', Spine='Chest',
    neck='Neck1', Head='Head',
    LeftShoulder='LeftShoulder', LeftArm='LeftArm', LeftForeArm='LeftForeArm', LeftHand='LeftHand',
    RightShoulder='RightShoulder', RightArm='RightArm', RightForeArm='RightForeArm', RightHand='RightHand',
    LeftUpLeg='LeftLeg', LeftLeg='LeftShin', LeftFoot='LeftFoot', LeftToeBase='LeftToeBase',
    RightUpLeg='RightLeg', RightLeg='RightShin', RightFoot='RightFoot', RightToeBase='RightToeBase')
SOURCE_TIP = dict(Hips='Spine1', Chest='Neck1', Neck1='Neck2', Head='HeadEnd',
    LeftHand='LeftHandMiddle1', RightHand='RightHandMiddle1',
    LeftToeBase='LeftToeEnd', RightToeBase='RightToeEnd')
DEST_TIP = dict(Hips='Spine02', Spine='neck', Head='head_end')

def unit(v):
    return v / max(np.linalg.norm(v), 1e-10)

def swing(a, b):
    a,b=unit(a),unit(b)
    cross=np.cross(a,b); dot=np.clip(np.dot(a,b),-1,1)
    if dot < -.999999:
        axis=unit(np.cross(a,[1,0,0] if abs(a[0])<.9 else [0,1,0]))
        return R.from_rotvec(axis*np.pi).as_matrix()
    if np.linalg.norm(cross)<1e-8:return np.eye(3)
    return R.from_rotvec(unit(cross)*np.arccos(dot)).as_matrix()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('reference',type=Path)
    parser.add_argument('output',type=Path)
    a=parser.parse_args()
    soma=json.loads((a.input/'soma-rest.json').read_text())
    names=soma['names']; neutral=np.array(soma['positions'])
    g=GLTF2.load(a.reference)
    byname={n.name:i for i,n in enumerate(g.nodes) if n.name}
    parents={c:i for i,n in enumerate(g.nodes) for c in n.children or []}
    cache={}
    def world(i):
        if i not in cache:
            n=g.nodes[i]
            if n.matrix: mat=np.array(n.matrix).reshape(4,4).T
            else:
                mat=np.eye(4);mat[:3,:3]=R.from_quat(n.rotation or [0,0,0,1]).as_matrix()@np.diag(n.scale or [1,1,1]);mat[:3,3]=n.translation or [0,0,0]
            cache[i]=world(parents[i])@mat if i in parents else mat
        return cache[i]
    rest={}; offsets={}
    for dst,src in MAPPING.items():
        if dst not in byname:raise ValueError('Missing target bone '+dst)
        i=byname[dst]; mat=world(i); rest[dst]=R.from_matrix(mat[:3,:3]).as_matrix()
        si=names.index(src)
        tip=SOURCE_TIP.get(src)
        if tip is None:
            tip=next((names[k] for k,p in enumerate(soma['parents']) if p==si),None)
        ns=neutral[names.index(tip)]-neutral[si] if tip else [0,1,0]
        di=byname.get(DEST_TIP.get(dst))
        if di is None:di=next((c for c in g.nodes[i].children or [] if g.nodes[c].name in MAPPING),None)
        nd=world(di)[:3,3]-mat[:3,3] if di is not None else rest[dst]@np.array([0,1,0])
        offsets[dst]=swing(nd,ns)@rest[dst]
    output=dict(version=1, reference='assets/anim/anims.glb', fps=30, clips=[])
    for filename,title in [('rising','Sword_Pilot_Rising'),('sweep','Sword_Pilot_Sweep'),('chop','Sword_Pilot_Chop')]:
        data=np.load(a.input/(filename+'.npz'),allow_pickle=False)
        global_rot=data['global_rot_mats'];pos=data['posed_joints']
        if not np.isfinite(global_rot).all():raise ValueError('Non-finite motion')
        # Normalize the initial heading using the hip line, preserving subsequent torso rotation.
        left=pos[0,names.index('LeftLeg')];right=pos[0,names.index('RightLeg')]
        across=unit(left-right); forward=unit(np.cross(across,[0,1,0]))
        yaw=np.arctan2(forward[0],forward[2]); yaw_inv=R.from_euler('y',-yaw).as_matrix()
        worlds={dst: yaw_inv@global_rot[:,names.index(src)]@offsets[dst] for dst,src in MAPPING.items()}
        tracks=[];times=(np.arange(len(pos))/30).round(7).tolist()
        for dst in MAPPING:
            parent=parents.get(byname[dst]); pname=g.nodes[parent].name if parent is not None else None
            pw=worlds[pname] if pname in worlds else R.from_matrix(world(parent)[:3,:3]).as_matrix() if parent is not None else np.eye(3)
            local=np.swapaxes(pw,-1,-2)@worlds[dst]
            q=R.from_matrix(local).as_quat()
            for k in range(1,len(q)):
                if np.dot(q[k],q[k-1])<0:q[k]*=-1
            tracks.append(dict(name=dst+'.quaternion',type='quaternion',times=times,values=q.round(7).ravel().tolist()))
        hip=pos[:,names.index('Hips'),1]
        # Match the old library's units and resting hip height, keeping source crouch/recoil.
        base=float(world(byname['Hips'])[1,3])
        ref_local=float(g.nodes[byname['Hips']].translation[1])
        heights=ref_local+(hip-hip[0])*(ref_local/max(float(hip[0]),.1))
        hand=pos[:,names.index('RightHand')]
        speeds=np.linalg.norm(np.diff(hand,axis=0),axis=1)
        lo=max(1,int(len(speeds)*.15));hi=max(lo+1,int(len(speeds)*.8))
        impact=(lo+int(np.argmax(speeds[lo:hi]))+1)/(len(pos)-1)
        output['clips'].append(dict(name=title,duration=times[-1],tracks=tracks,
            hip=dict(times=times,ys=heights.round(6).tolist()), impact=round(impact,6)))
        print(title,'frames',len(pos),'impact',round(impact,3))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(output,separators=(',',':')))

if __name__=='__main__':main()
