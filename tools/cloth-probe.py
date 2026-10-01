#!/usr/bin/env python3
"""Read GLB bind weights and report conservative rear-cloth candidates (no render)."""
import argparse
import json
import struct
from pathlib import Path
import numpy as np

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('classes',nargs='*',default=['berserker','skeleton'])
args=parser.parse_args()

def load(path):
    blob=Path(path).read_bytes();size=struct.unpack_from('<I',blob,12)[0]
    doc=json.loads(blob[20:20+size]);binary=blob[28+size:]
    def accessor(index):
        acc=doc['accessors'][index];view=doc['bufferViews'][acc['bufferView']]
        dtype=np.dtype({5126:'f4',5123:'u2',5121:'u1',5125:'u4'}[acc['componentType']])
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[acc['type']]
        return np.ndarray((acc['count'],width),dtype=dtype,buffer=binary,offset=view.get('byteOffset',0)+acc.get('byteOffset',0),strides=(view.get('byteStride',width*dtype.itemsize),dtype.itemsize)).copy()
    def local(node):
        if 'matrix' in node:return np.array(node['matrix']).reshape(4,4).T
        x,y,z,w=node.get('rotation',[0,0,0,1])
        rotation=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
        matrix=np.eye(4);matrix[:3,:3]=rotation@np.diag(node.get('scale',[1,1,1]));matrix[:3,3]=node.get('translation',[0,0,0]);return matrix
    worlds={}
    def visit(i,parent):
        worlds[i]=parent@local(doc['nodes'][i])
        for child in doc['nodes'][i].get('children',[]):visit(child,worlds[i])
    for root in doc['scenes'][doc.get('scene',0)]['nodes']:visit(root,np.eye(4))
    mesh_index=next(i for i,node in enumerate(doc['nodes']) if 'mesh' in node)
    node=doc['nodes'][mesh_index];prim=doc['meshes'][node['mesh']]['primitives'][0]
    skin=doc['skins'][node['skin']];names=[doc['nodes'][i]['name'] for i in skin['joints']]
    positions=accessor(prim['attributes']['POSITION']);weights=accessor(prim['attributes']['WEIGHTS_0']);joints=accessor(prim['attributes']['JOINTS_0'])
    ibms=accessor(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
    matrices=np.array([worlds[i]@ibms[k] for k,i in enumerate(skin['joints'])])
    # GLTFLoader.bind 使用 identity；attached 模式的 mesh world 与 bind inverse 抵消。
    bind=np.column_stack((positions,np.ones(len(positions))))
    actual=np.zeros((len(positions),4))
    for k in range(4):actual+=np.einsum('nij,nj->ni',matrices[joints[:,k]],bind)*weights[:,k,None]
    bones={doc['nodes'][i]['name']:worlds[i][:3,3] for i in skin['joints']}
    return actual[:,:3],weights,joints,names,bones,accessor(prim['indices']).reshape(-1,3)

for cls in args.classes:
    positions,weights,joints,names,bones,triangles=load(Path(__file__).resolve().parents[1]/'assets/models/rigged'/f'{cls}.glb')
    nearest=np.full(len(positions),np.inf)
    for side in ['Left','Right']:
        for a,b in [(side+'Arm',side+'ForeArm'),(side+'ForeArm',side+'Hand'),(side+'UpLeg',side+'Leg'),(side+'Leg',side+'Foot')]:
            start,end=bones[a],bones[b];segment=end-start
            t=np.clip((positions-start)@segment/(segment@segment),0,1)
            nearest=np.minimum(nearest,np.linalg.norm(positions-start-t[:,None]*segment,axis=1))
    candidate=(positions[:,2]<-.12)&(positions[:,1]>.08)&(positions[:,1]<1.30)&(nearest>.13)
    arm=sum(weights[:,k]*np.array(['Arm' in names[i] or 'Hand' in names[i] for i in joints[:,k]]) for k in range(4))
    leg=sum(weights[:,k]*np.array(['Leg' in names[i] or 'Foot' in names[i] for i in joints[:,k]]) for k in range(4))
    sample=[]
    wanted=[np.array([.428806,.964383,-.235930]),np.array([.005162,.303091,-.394368])]
    for target in wanted:
        i=int(np.linalg.norm(positions-target,axis=1).argmin())
        sample.append({'vertex':i,'position':positions[i].tolist(),'candidate':bool(candidate[i]),'limbDistance':float(nearest[i]),'weights':[{names[int(joints[i,k])]:float(weights[i,k])} for k in range(4) if weights[i,k]>.01]})
    print(json.dumps({'cls':cls,'vertices':len(positions),'rearCandidates':int(candidate.sum()),'armBound':int((candidate&(arm>.5)).sum()),'legBound':int((candidate&(leg>.5)).sum()),'sample':sample},ensure_ascii=False))
