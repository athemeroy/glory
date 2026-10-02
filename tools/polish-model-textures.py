"""Polish only source albedo; preserve source size and authored PBR maps.

python tools/polish-model-textures.py OUTPUT [CLASS...]
This follows the Blender geometry pass; it never rewrites rigged originals.
"""
import argparse, copy, hashlib, io, json, struct
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter, ImageDraw
import numpy as np

def access(g,binary,index):
 a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']]);return np.ndarray((a['count'],width),dtype=dtype,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',width*dtype.itemsize),dtype.itemsize))

def face_mask(g,binary,size):
 primitive=g['meshes'][0]['primitives'][0];attrs=primitive['attributes'];pos=access(g,binary,attrs.get('_GLORY_REPAIR_POSITION',attrs['POSITION']));uv=access(g,binary,attrs['TEXCOORD_0']);si=access(g,binary,attrs['JOINTS_0']);sw=access(g,binary,attrs['WEIGHTS_0']);tri=access(g,binary,primitive['indices']).reshape(-1,3)
 names=[g['nodes'][index].get('name','') for index in g['skins'][0]['joints']];head_indices=[i for i,name in enumerate(names) if name in ('Head','neck','Neck')];head_weight=np.sum(np.where(np.isin(si,head_indices),sw,0),axis=1)
 height=pos[:,1].max()-pos[:,1].min();selected=(head_weight>.45)&(pos[:,1]>height*.835)&(pos[:,1]<height*.982)&(np.abs(pos[:,0])<.125)&(pos[:,2]>.035)
 triangles=tri[np.all(selected[tri],axis=1)];mask=Image.new('L',size);draw=ImageDraw.Draw(mask);W,H=size
 for triangle in triangles:
  values=uv[triangle]
  if np.ptp(values[:,0])>.25 or np.ptp(values[:,1])>.25:continue
  # glTF texture UV origin is the upper left, matching the unflipped source.
  draw.polygon([(float(u)*W,float(v)*H) for u,v in values],fill=255)
 return mask.filter(ImageFilter.GaussianBlur(1.0)),int(len(triangles))

def clean_face(image,mask):
 source=np.asarray(image,dtype=np.float32);region=np.asarray(mask,dtype=np.float32)/255
 # Preserve dark eyes/lashes/mouth and richly colored hair. The correction is
 # restricted to head-front UVs and skin-like colors, with feathered borders.
 brightness=source.mean(axis=2);spread=source.max(axis=2)-source.min(axis=2)
 skin=(brightness>55)&(spread<95)&(source[:,:,0]>source[:,:,2]*.88)&(source[:,:,0]<source[:,:,1]*1.6)
 influence=region*skin*.66
 denoised=np.asarray(image.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(.45)),dtype=np.float32)
 # Only modest brightness lift in fragmented baked midtones; highlighted skin
 # and original facial feature color remain intact.
 denoised+=np.clip((170-brightness)*.025,0,3)[:,:,None]
 result=source*(1-influence[:,:,None])+denoised*influence[:,:,None]
 return Image.fromarray(np.clip(result,0,255).astype(np.uint8)),int(np.count_nonzero(influence>.05))

# Tailor skin/leather/cloth/armor reflectance instead of making every costume
# uniformly metallic. Source metallic/roughness maps remain untouched.
MATERIALS={
 'unspecialized':(.72,.94), 'swordmaster':(.80,.93), 'battlemage':(.84,.92),
 'striker':(.48,.97), 'sharpshooter':(.67,.94), 'launcher':(.67,.94),
 'warlock':(.56,.98), 'cleric':(.66,.96), 'witch':(.56,.98),
 'berserker':(.88,.92), 'assassin':(.54,.97), 'thug':(.54,.97),
 'frostcaster':(.82,.94), 'boss':(.88,.94), 'skeleton':(.84,.96),
}
FACE_SCULPT={
 'cleric':(1.455,1.615,.098,.010), 'swordmaster':(1.485,1.665,.098,.008),
 'striker':(1.485,1.625,.090,.007), 'battlemage':(1.495,1.725,.092,.008),
 'unspecialized':(1.485,1.665,.098,.006), 'sharpshooter':(1.490,1.640,.092,.006),
 'launcher':(1.485,1.650,.092,.006), 'warlock':(1.485,1.660,.092,.006),
 'witch':(1.485,1.670,.092,.006), 'berserker':(1.485,1.660,.098,.005),
 'assassin':(1.470,1.640,.086,.006), 'thug':(1.485,1.650,.098,.006),
 # Preserve the authored pale/skeletal face detail and ornamental armor.
 'frostcaster':(1.500,1.705,.086,.003), 'boss':(1.485,1.650,.098,.003),
 'skeleton':(1.490,1.640,.086,.002),
}

def repair_face_fragments(g,binary,image,cls):
 low,high,width,cap=FACE_SCULPT[cls];primitive=g['meshes'][0]['primitives'][0];at=primitive['attributes'];pos=access(g,binary,at.get('_GLORY_REPAIR_POSITION',at['POSITION']));uv=access(g,binary,at['TEXCOORD_0']);si=access(g,binary,at['JOINTS_0']);sw=access(g,binary,at['WEIGHTS_0']);tri=access(g,binary,primitive['indices']).reshape(-1,3)
 names=[g['nodes'][index].get('name','') for index in g['skins'][0]['joints']];head_indices=[i for i,name in enumerate(names) if name in ('Head','neck','Neck')];head_weight=np.sum(np.where(np.isin(si,head_indices),sw,0),axis=1)
 source=np.asarray(image,dtype=np.float32);H,W=source.shape[:2];sample=source[np.clip((uv[:,1]*H).astype(int),0,H-1),np.clip((uv[:,0]*W).astype(int),0,W-1)]
 geometric=(head_weight>.5)&(pos[:,1]>low)&(pos[:,1]<high)&(np.abs(pos[:,0])<width)&(pos[:,2]>.025)
 skin=(sample.mean(axis=1)>65)&((sample.max(axis=1)-sample.min(axis=1))<110)&(sample[:,0]>sample[:,2]*.86)&(sample[:,0]<sample[:,1]*1.65)
 selected=geometric&skin;sculpt={'vertices':np.where(selected)[0].astype(int).tolist(),'bounds':[low,high,width],'cap':cap}
 mask=Image.new('L',image.size);protected=Image.new('L',image.size);draw=ImageDraw.Draw(mask);feature_draw=ImageDraw.Draw(protected);eye=(low+high)/2+.035;mouth=low+.034
 for triangle in tri[np.all(geometric[tri],axis=1)]:
  values=uv[triangle]
  if np.ptp(values[:,0])>.25 or np.ptp(values[:,1])>.25:continue
  center_uv=values.mean(axis=0);center_color=source[min(H-1,max(0,int(center_uv[1]*H))),min(W-1,max(0,int(center_uv[0]*W)))];is_skin=center_color.mean()>65 and center_color.max()-center_color.min()<110 and center_color[0]>center_color[2]*.86 and center_color[0]<center_color[1]*1.65
  # A black UV gutter can surround a flesh-colored triangle, while actual hair
  # remains dark inside. Classify triangle interiors before extending gutters.
  if not is_skin:continue
  polygon=[(float(u)*W,float(v)*H) for u,v in values];draw.polygon(polygon,fill=255);center=pos[triangle].mean(axis=0)
  if (abs(center[1]-eye)<.017 and .022<abs(center[0])<.075) or (abs(center[1]-mouth)<.011 and abs(center[0])<.052):feature_draw.polygon(polygon,fill=255)
 alpha=np.asarray(mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(.55)),dtype=np.float32)/255;protect=np.asarray(protected.filter(ImageFilter.MaxFilter(3)),dtype=np.float32)/255
 valid=(alpha>.2)&(source.mean(axis=2)>75)&((source.max(axis=2)-source.min(axis=2))<110)&(source[:,:,0]>source[:,:,2]*.86)
 if not valid.any():return image,sculpt,{'pixels':0}
 tone=np.median(source[valid],axis=0);brightness=source.mean(axis=2);dark=brightness<tone.mean()*.44
 strength=alpha*(1-protect)*np.where(dark,.88,.15)
 # Skeletal faces and the already clean frost caster need only conservative
 # seam correction; no human skin recoloring on their painted ornaments.
 if cls in ('frostcaster','boss','skeleton'):strength*=.28
 repaired=source*(1-strength[:,:,None])+tone[None,None,:]*strength[:,:,None]
 return Image.fromarray(np.clip(repaired,0,255).astype(np.uint8)),sculpt,{'pixels':int(np.count_nonzero(strength>.05)),'darkCrackPixels':int(np.count_nonzero(dark&(strength>.4))),'skinTone':tone.tolist()}
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory',type=Path);parser.add_argument('classes',nargs='*');args=parser.parse_args();results=[]
for cls in args.classes or MATERIALS:
 path=args.directory/f'{cls}.glb';data=path.read_bytes();n,t=struct.unpack_from('<II',data,12);g=json.loads(data[20:20+n]);offset=20+n;n,t=struct.unpack_from('<II',data,offset);binary=bytearray(data[offset+8:offset+8+n]);source_materials=copy.deepcopy(g['materials'])
 albedo_indices={g['textures'][m['pbrMetallicRoughness']['baseColorTexture']['index']]['source'] for m in g['materials'] if m.get('pbrMetallicRoughness',{}).get('baseColorTexture')};textures=[]
 for image_index in albedo_indices:
  image=g['images'][image_index];view=g['bufferViews'][image['bufferView']];original=bytes(binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]);im=Image.open(io.BytesIO(original)).convert('RGB')
  # A small local contrast/sharpness correction exposes existing source detail;
  # no upscaling or fabricated face detail is used.
  fragment_cleaned,sculpt,fragment_report=repair_face_fragments(g,binary,im,cls)
  (args.directory/f'{cls}-face-sculpt.json').write_text(json.dumps(sculpt))
  mask,face_triangles=face_mask(g,binary,im.size);cleaned,face_pixels=clean_face(fragment_cleaned,mask)
  polished=ImageEnhance.Contrast(cleaned).enhance(1.025).filter(ImageFilter.UnsharpMask(radius=.65,percent=40,threshold=5));encoded=io.BytesIO();polished.save(encoded,format='JPEG',quality=97,subsampling=0,optimize=True);encoded=encoded.getvalue()
  binary+=b'\0'*((-len(binary))%4);g['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(encoded)});binary+=encoded;image['bufferView']=len(g['bufferViews'])-1;image['mimeType']='image/jpeg'
  textures.append({'sourceSize':list(im.size),'outputSize':list(polished.size),'faceTriangles':face_triangles,'facePixelsRepaired':face_pixels,'fragmentRepair':fragment_report,'sourceHash':hashlib.sha256(original).hexdigest(),'outputHash':hashlib.sha256(encoded).hexdigest()})
  debug=args.directory/'texture-debug';debug.mkdir(exist_ok=True);mask.save(debug/f'{cls}-face-mask.png');im.save(debug/f'{cls}-source.jpg');polished.save(debug/f'{cls}-polished.jpg')
 metallic,roughness=MATERIALS[cls]
 for material in g['materials']:
  pbr=material.setdefault('pbrMetallicRoughness',{});pbr['metallicFactor']=metallic if pbr.get('metallicRoughnessTexture') else pbr.get('metallicFactor',0);pbr['roughnessFactor']=roughness
  if not pbr.get('metallicRoughnessTexture'):
   material['emissiveFactor']=[.08,.08,.08]
   specular=material.get('extensions',{}).get('KHR_materials_specular')
   if specular:specular['specularColorFactor']=[.65,.65,.65]
 g['buffers'][0]['byteLength']=len(binary);payload=json.dumps(g,separators=(',',':'),ensure_ascii=False).encode();payload+=b' '*((-len(payload))%4);binary+=b'\0'*((-len(binary))%4)
 path.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(payload)+8+len(binary))+struct.pack('<II',len(payload),0x4e4f534a)+payload+struct.pack('<II',len(binary),0x004e4942)+binary)
 result={'class':cls,'textures':textures,'materialFactors':{'metallic':g['materials'][0]['pbrMetallicRoughness']['metallicFactor'],'roughness':roughness},'sha256Output':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceMaterials':source_materials};results.append(result);print(json.dumps(result),flush=True)
(args.directory/'texture-report.json').write_text(json.dumps({'characters':results},indent=2))
