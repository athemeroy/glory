"""Blender 4.5 offline polish, preserving original GLB rig, UV and vertex IDs.

blender -b --factory-startup --python tools/blender-polish-models.py -- INPUT OUTPUT [CLASS...]
Only POSITION/NORMAL bytes and accessor bounds change. The original source is
never overwritten. A temporary welded Blender mesh prevents UV seams from
separating during smoothing; its topology is never exported into the game.
"""
import bpy, json, struct, sys, hashlib
from pathlib import Path
import numpy as np

CLASSES = 'unspecialized swordmaster battlemage striker sharpshooter launcher warlock cleric witch berserker assassin thug frostcaster boss skeleton'.split()
# Cloth silhouettes can accept a slightly softer surface. Armor, gauntlets,
# skeletal ornaments and facial features retain smaller displacements.
SETTINGS = {
    'unspecialized': (.34, 4, .0032, .62), 'swordmaster': (.32, 4, .0030, .60),
    'battlemage': (.30, 4, .0030, .56), 'striker': (.34, 4, .0028, .60),
    'sharpshooter': (.34, 4, .0032, .62), 'launcher': (.32, 4, .0030, .60),
    'warlock': (.36, 4, .0040, .68), 'cleric': (.38, 4, .0040, .72),
    'witch': (.36, 4, .0038, .68), 'berserker': (.25, 3, .0020, .46),
    'assassin': (.32, 4, .0028, .60), 'thug': (.34, 4, .0032, .62),
    'frostcaster': (.32, 4, .0030, .60), 'boss': (.24, 3, .0020, .44),
    'skeleton': (.22, 3, .0018, .40),
}
DTYPES={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
WIDTHS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def read_glb(path):
    data=path.read_bytes(); magic, version, total=struct.unpack_from('<III',data)
    assert magic==0x46546c67 and version==2 and total==len(data)
    n,t=struct.unpack_from('<II',data,12);assert t==0x4e4f534a
    g=json.loads(data[20:20+n]);offset=20+n;n,t=struct.unpack_from('<II',data,offset)
    assert t==0x004e4942
    return g, bytearray(data[offset+8:offset+8+n])

def accessor(g, binary, index):
    a=g['accessors'][index];assert 'sparse' not in a
    v=g['bufferViews'][a['bufferView']];dtype=np.dtype(DTYPES[a['componentType']]);width=WIDTHS[a['type']]
    offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',dtype.itemsize*width)
    return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=offset,strides=(stride,dtype.itemsize))

def write_glb(path,g,binary):
    g['buffers'][0]['byteLength']=len(binary)
    payload=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();payload+=b' '*((-len(payload))%4)
    binary+=b'\0'*((-len(binary))%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(payload)+8+len(binary))+struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(binary),0x004e4942)+binary)

def digest(value):return hashlib.sha256(value).hexdigest()

def polish(source,destination,cls):
    g,binary=read_glb(source);before=bytes(binary)
    primitives=[p for m in g['meshes'] for p in m['primitives']]
    assert len(primitives)==1,'certification requires exactly one source body primitive'
    primitive=primitives[0];attrs=primitive['attributes'];p=accessor(g,binary,attrs['POSITION']);n=accessor(g,binary,attrs['NORMAL']);tri=accessor(g,binary,primitive['indices']).reshape(-1,3)
    original=p.copy();original_n=n.copy()
    # Weld only the temporary sculpt surface, to 1 micrometer. Original UV
    # seams, shading boundaries, joints and cloth repair IDs remain unchanged.
    _,first,inverse=np.unique(np.round(original*1e6).astype(np.int64),axis=0,return_index=True,return_inverse=True)
    unique=original[first].copy();faces=inverse[tri]
    valid=(faces[:,0]!=faces[:,1])&(faces[:,1]!=faces[:,2])&(faces[:,0]!=faces[:,2]);faces=faces[valid]
    mesh=bpy.data.meshes.new(cls+'-polish-surface');mesh.from_pydata(unique.tolist(),[],faces.tolist());mesh.update()
    obj=bpy.data.objects.new(cls+'-polish-surface',mesh);bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active=obj;obj.select_set(True)
    factor,iterations,cap,normal_blend=SETTINGS[cls]
    modifier=obj.modifiers.new('Conservative surface relaxation','SMOOTH');modifier.factor=factor;modifier.iterations=iterations
    sculpt_file=destination.parent/f'{cls}-face-sculpt.json';face_sculpt=None;sculpt_strength=np.zeros(len(unique),dtype=np.float32)
    if sculpt_file.exists():
        face_sculpt=json.loads(sculpt_file.read_text());original_mask=np.zeros(len(original),dtype=np.float32);original_mask[face_sculpt['vertices']]=1
        np.maximum.at(sculpt_strength,inverse,original_mask)
        group=obj.vertex_groups.new(name='Protected facial skin polish')
        group.add(np.where(sculpt_strength>.5)[0].astype(int).tolist(),1.0,'REPLACE')
        facial=obj.modifiers.new('Remove fractured facial surface','SMOOTH');facial.factor=.55;facial.iterations=12;facial.vertex_group=group.name
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());processed=evaluated.to_mesh()
    vertices=np.empty(len(unique)*3,dtype=np.float32);processed.vertices.foreach_get('co',vertices);vertices=vertices.reshape(-1,3)
    delta=vertices-unique;length=np.linalg.norm(delta,axis=1)
    # Preserve face, fingers, toes and ground-contact silhouettes even more.
    height=np.max(original[:,1])-np.min(original[:,1]);local_cap=np.full(len(unique),cap,dtype=np.float32)
    face=(unique[:,1]>height*.82)&(np.abs(unique[:,0])<.19)&(unique[:,2]>.025)
    local_cap[face]=np.minimum(local_cap[face],.00085)
    if face_sculpt is not None:local_cap[sculpt_strength>.5]=face_sculpt['cap']
    local_cap[unique[:,1]<.055]=np.minimum(local_cap[unique[:,1]<.055],.0004)
    local_cap[np.abs(unique[:,0])>.34]=np.minimum(local_cap[np.abs(unique[:,0])>.34],.0008)
    delta*=np.minimum(1,local_cap/np.maximum(length,1e-12))[:,None]
    new_positions=unique+delta
    # Ask Blender to recompute the smoothed surface normals after the bounded
    # sculpt. Retain original hard surface directions where a seam differs by
    # more than 50 degrees, instead of rounding armor/hair blade edges.
    mesh.vertices.foreach_set('co',new_positions.astype(np.float32).reshape(-1));mesh.update()
    smooth_n=np.empty(len(unique)*3,dtype=np.float32);mesh.vertices.foreach_get('normal',smooth_n);smooth_n=smooth_n.reshape(-1,3)[inverse]
    agreement=np.sum(original_n*smooth_n,axis=1)
    blend=np.where(agreement>.64,normal_blend,0)[:,None]
    if face_sculpt is not None:blend[sculpt_strength[inverse]>.5]=.95
    new_normals=original_n*(1-blend)+smooth_n*blend;new_normals/=np.maximum(np.linalg.norm(new_normals,axis=1)[:,None],1e-12)
    p[:]=new_positions[inverse];n[:]=new_normals
    g['accessors'][attrs['POSITION']]['min']=p.min(axis=0).astype(float).tolist();g['accessors'][attrs['POSITION']]['max']=p.max(axis=0).astype(float).tolist()
    unchanged={}
    for name,index in attrs.items():
        if name not in ('POSITION','NORMAL'):
            unchanged[name]=digest(accessor(g,binary,index).tobytes());assert accessor(g,binary,index).tobytes()==accessor(g,before,index).tobytes()
    assert accessor(g,binary,primitive['indices']).tobytes()==accessor(g,before,primitive['indices']).tobytes()
    for skin in g['skins']:
        index=skin.get('inverseBindMatrices')
        if index is not None:assert accessor(g,binary,index).tobytes()==accessor(g,before,index).tobytes()
    # Runtime component/cloth certification reads this source attribute. It is
    # ignored by the shader and is never used for visible or collision geometry.
    binary+=b'\0'*((-len(binary))%4);original_bytes=original.astype('<f4').tobytes()
    g['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(original_bytes),'target':34962});binary+=original_bytes
    g['accessors'].append({'bufferView':len(g['bufferViews'])-1,'componentType':5126,'count':len(original),'type':'VEC3','min':original.min(axis=0).astype(float).tolist(),'max':original.max(axis=0).astype(float).tolist()})
    attrs['_GLORY_REPAIR_POSITION']=len(g['accessors'])-1
    destination.parent.mkdir(parents=True,exist_ok=True);write_glb(destination,g,binary)
    displacement=np.linalg.norm(p-original,axis=1);angles=np.arccos(np.clip(np.sum(original_n*n,axis=1),-1,1))
    result={'class':cls,'blender':bpy.app.version_string,'source':source.name,'sha256Source':digest(source.read_bytes()),'sha256Output':digest(destination.read_bytes()),'vertices':len(p),'temporaryWeldedVertices':len(unique),'triangles':len(tri),'bones':len(g['skins'][0]['joints']),'maxMoveMillimeters':float(displacement.max()*1000),'meanMoveMillimeters':float(displacement.mean()*1000),'faceMaxMoveMillimeters':float(np.linalg.norm(delta[face],axis=1).max()*1000) if face.any() else 0,'facialSculptVertices':int(np.count_nonzero(sculpt_strength)),'meanNormalChangeDegrees':float(np.mean(angles)*180/np.pi),'unchangedAttributes':unchanged,'rigUVWeightsIndicesUnchanged':True,'settings':{'factor':factor,'iterations':iterations,'maxDisplacementMeters':cap,'normalBlend':normal_blend}}
    evaluated.to_mesh_clear();bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
    print(json.dumps(result),flush=True);return result

argv=sys.argv[sys.argv.index('--')+1:];input_dir,output_dir=map(Path,argv[:2]);classes=argv[2:] or CLASSES
bpy.ops.wm.read_factory_settings(use_empty=True);results=[]
for cls in classes:
    assert cls in SETTINGS
    results.append(polish(input_dir/f'{cls}.glb',output_dir/f'{cls}.glb',cls))
(output_dir/'geometry-report.json').write_text(json.dumps({'method':'Blender temporary welded sculpt; original GLB attribute patch','characters':results},indent=2,ensure_ascii=False))
