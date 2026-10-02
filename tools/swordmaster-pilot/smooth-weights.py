# blender -b -P bl_smooth.py -- IN_RIGGED.glb OUT.glb [repeat] [factor]
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
IN, OUT = argv[0], argv[1]
REP = int(argv[2]) if len(argv) > 2 else 12
FAC = float(argv[3]) if len(argv) > 3 else 0.6
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=IN)
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')
print('after merge verts', len(mesh.data.vertices))
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=FAC, repeat=REP, expand=0.0)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_skins=True, export_image_format='JPEG', export_jpeg_quality=92)
print('SMOOTHED', OUT)
