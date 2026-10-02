"""CPU-only source-head preview; no Chrome/Metal GPU or asset mutation."""
import bpy,sys
from mathutils import Vector
from pathlib import Path
argv=sys.argv[sys.argv.index('--')+1:];source,output=map(Path,argv[:2]);bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.render.resolution_x=640;scene.render.resolution_y=800;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.10,.13,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
bpy.ops.object.camera_add(location=(-.12,-.80,1.64));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.60))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=55;scene.camera=camera
for position,power,size in [((2,-3,4),450,3),((-2,-1,3),300,2),((0,2,3),350,2)]:
 bpy.ops.object.light_add(type='AREA',location=position);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1.60))-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(output);bpy.ops.render.render(write_still=True)
