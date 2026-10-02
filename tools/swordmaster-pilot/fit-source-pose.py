"""Blender: repose donor arms to the pilot's shallow A-pose before weight transfer.

This prevents wrist/forearm vertices from inheriting torso weights merely
because the original donor has a wider A-pose. Input/output are separate files.
"""
import bpy
import sys
import math
from mathutils import Vector

src,out=sys.argv[sys.argv.index('--')+1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
# Blender imports glTF Y-up into Z-up; express desired directions in glTF,
# then transform through the imported armature's world-to-local basis.
to_local=arm.matrix_world.to_3x3().inverted()
for side,sign in [('Right',-1),('Left',1)]:
    for name,child,angle in [('Arm','ForeArm',23),('ForeArm','Hand',12)]:
        bone=arm.pose.bones[side+name];tip=arm.pose.bones[side+child]
        bpy.context.view_layer.update()
        current=(tip.head-bone.head).normalized()
        rad=math.radians(angle)
        desired_world=Vector((sign*math.sin(rad),0,-math.cos(rad)))
        desired=(to_local@desired_world).normalized()
        change=current.rotation_difference(desired).to_matrix().to_4x4()
        matrix=bone.matrix.copy()
        matrix=change@matrix
        matrix.translation=bone.head.copy()
        bone.matrix=matrix
        bpy.context.view_layer.update()
for mesh in [o for o in bpy.data.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active=mesh
    for mod in list(mesh.modifiers):
        if mod.type=='ARMATURE':bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True);bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for mesh in [o for o in bpy.data.objects if o.type=='MESH']:
    mod=mesh.modifiers.new('Armature','ARMATURE');mod.object=arm
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_skins=True,
                         export_image_format='JPEG',export_jpeg_quality=92)
print('PILOT_DONOR_DONE',out)
