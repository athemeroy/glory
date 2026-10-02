"""Export SOMA neutral positions for reproducible offline retargeting."""
import json
from kimodo.skeleton import SOMASkeleton77
s = SOMASkeleton77()
with open(r'D:\kimodo\out\swordmaster-pilot\soma-rest.json', 'w') as f:
    json.dump(dict(names=s.bone_order_names, parents=s.joint_parents.tolist(),
                   positions=s.neutral_joints.tolist()), f)
