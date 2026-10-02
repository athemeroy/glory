"""Remove accidental glove/hem bridges in this pilot mesh; preserve the v1 source.

Works only on the certified pilot export. Within the glove/hem contact region,
vertices retain their dominant anatomical region; competing arm/leg weights
are removed. Faces spanning those two regions are the accidental bridges.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from pygltflib import GLTF2, Accessor, BufferView

p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
if a.source.resolve()==a.output.resolve():raise SystemExit('Source must be preserved')
if hashlib.sha256(a.source.read_bytes()).hexdigest()!='d8898ec5137004ee5a37176c3d09858aceef178ac8fcea8da07ede4bef97769f':
    raise SystemExit('Not the certified pilot source hash')
g=GLTF2.load(a.source);blob=bytearray(g.binary_blob());prim=g.meshes[0].primitives[0]
if g.accessors[prim.attributes.POSITION].count!=79029:
    raise SystemExit('Not the certified pilot mesh')
def read(ai,n):
    acc=g.accessors[ai];v=g.bufferViews[acc.bufferView];dt={5126:np.float32,5123:np.uint16,5121:np.uint8,5125:np.uint32}[acc.componentType]
    if v.byteStride and v.byteStride!=np.dtype(dt).itemsize*n:raise ValueError('Interleaved attribute')
    return np.frombuffer(blob,dtype=dt,count=acc.count*n,offset=(v.byteOffset or 0)+(acc.byteOffset or 0)).reshape(-1,n).copy()
pos=read(prim.attributes.POSITION,3);j=read(prim.attributes.JOINTS_0,4);w=read(prim.attributes.WEIGHTS_0,4);idx=read(prim.indices,1).ravel().reshape(-1,3)
names=[g.nodes[i].name for i in g.skins[0].joints]
region=(np.abs(pos[:,0])>.16)&(np.abs(pos[:,0])<.37)&(pos[:,1]>.60)&(pos[:,1]<.98)
is_arm=np.array([('Arm' in n or 'Hand' in n or 'Shoulder' in n) for n in names])[j]
is_lower=np.array([('Leg' in n or 'Foot' in n or n=='Hips') for n in names])[j]
arm_mass=(w*is_arm).sum(1);lower_mass=(w*is_lower).sum(1)
ambiguous=region&(arm_mass>.01)&(lower_mass>.01)
arm_side=arm_mass>lower_mass
for v in np.where(ambiguous)[0]:
    w[v]*=is_arm[v] if arm_side[v] else ~is_arm[v]
    w[v]/=w[v].sum()
mixed=arm_side[idx].any(1)&(~arm_side[idx]).any(1)
bridges=mixed&region[idx].all(1)&ambiguous[idx].any(1)
newidx=idx[~bridges].astype(np.uint32).ravel()
def append(arr,ctype,typ,target):
    while len(blob)%4:blob.append(0)
    off=len(blob);blob.extend(arr.tobytes());g.bufferViews.append(BufferView(buffer=0,byteOffset=off,byteLength=arr.nbytes,target=target))
    g.accessors.append(Accessor(bufferView=len(g.bufferViews)-1,componentType=ctype,type=typ,count=len(arr)))
    return len(g.accessors)-1
prim.attributes.WEIGHTS_0=append(w.astype(np.float32),5126,'VEC4',34962)
prim.indices=append(newidx,5125,'SCALAR',34963)
g.buffers[0].byteLength=len(blob);g.set_binary_blob(bytes(blob));a.output.parent.mkdir(parents=True,exist_ok=True);g.save_binary(a.output)
report=dict(source_sha256=hashlib.sha256(a.source.read_bytes()).hexdigest(),vertices_reweighted=int(ambiguous.sum()),bridge_faces_removed=int(bridges.sum()),faces_remaining=len(newidx)//3)
a.output.with_suffix('.repair.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
