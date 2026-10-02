#!/usr/bin/env python3
"""Read-only Frost chest source topology. No render and no weight edits."""
import ast
import json
import struct
from collections import defaultdict
from pathlib import Path
import numpy as np

PROJECT = Path(__file__).resolve().parents[1]
# Reuse the existing GLB reader without its CLI or candidate calculations.
module = ast.parse((PROJECT / 'tools/cloth-probe.py').read_text())
reader = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'load')
exec(compile(ast.Module(body=[reader], type_ignores=[]), 'cloth-probe.load', 'exec'))
positions, weights, joints, names, bones, triangles = load(PROJECT / 'assets/models/rigged/frostcaster.glb')
count = len(positions)
raw_parent = list(range(count))
weld_parent, cells, welded, aliases = [], {}, [], defaultdict(list)

def root(parent, index):
    while parent[index] != index:
        parent[index] = parent[parent[index]]
        index = parent[index]
    return index

for index, point in enumerate(positions):
    # Match JS Math.round(v / 50um), including negative half-cell values.
    key = tuple(np.floor(point / .00005 + .5).astype(int))
    if key not in cells:
        cells[key] = len(weld_parent)
        weld_parent.append(len(weld_parent))
    cell = cells[key]
    welded.append(cell)
    aliases[cell].append(index)

adjacency = defaultdict(set)
for triangle in triangles:
    a, b, c = map(int, triangle)
    for parent, vertices in [(raw_parent, [a, b, c]), (weld_parent, [welded[a], welded[b], welded[c]])]:
        roots = [root(parent, vertex) for vertex in vertices]
        parent[roots[1]] = roots[0]
        parent[roots[2]] = roots[0]
    for a, b in [(a,b), (b,c), (c,a)]:
        if welded[a] != welded[b]:
            adjacency[welded[a]].add(welded[b]); adjacency[welded[b]].add(welded[a])

raw_components, components = defaultdict(list), defaultdict(list)
for i in range(count):
    raw_components[root(raw_parent, i)].append(i)
    components[root(weld_parent, welded[i])].append(i)

def influences(vertex):
    result = defaultdict(float)
    for k in range(4):
        if weights[vertex,k] > 0:
            result[names[int(joints[vertex,k])]] += float(weights[vertex,k])
    return dict(sorted(result.items(), key=lambda item: -item[1]))

def summary(vertices):
    points = positions[vertices]
    sums = defaultdict(float)
    for vertex in vertices:
        for bone, weight in influences(vertex).items(): sums[bone] += weight
    return {'vertices':len(vertices), 'bounds':{'min':points.min(axis=0).tolist(), 'max':points.max(axis=0).tolist()},
            'meanWeights':dict(sorted(((bone,value/len(vertices)) for bone,value in sums.items()), key=lambda item:-item[1]))}

def vertex_report(vertex):
    return {'vertex':vertex,'position':positions[vertex].tolist(),'weights':influences(vertex),
            'aliases':aliases[welded[vertex]],'rawSheet':root(raw_parent, vertex),'component':root(weld_parent, welded[vertex])}

report = {'class':'frostcaster', 'vertices':count, 'triangles':len(triangles), 'boneCount':len(names),
          'sourceBones':{name:bones[name].tolist() for name in names}, 'targets':[]}
blob=(PROJECT/'assets/models/rigged/frostcaster.glb').read_bytes(); json_size=struct.unpack_from('<I',blob,12)[0]; doc=json.loads(blob[20:20+json_size])
parents={child:index for index,node in enumerate(doc['nodes']) for child in node.get('children',[])}
report['boneParents']={node.get('name'):doc['nodes'][parents[i]].get('name') if i in parents else None for i,node in enumerate(doc['nodes']) if node.get('name') in names}
for vertex in [16706,16708]:
    data=vertex_report(vertex)
    raw_vertices=raw_components[root(raw_parent,vertex)]
    closed_vertices=components[root(weld_parent,welded[vertex])]
    data['rawSheetInfo']=summary(raw_vertices)
    data['rawSheetVertices']=raw_vertices
    data['rawSheetTriangles']=[{'sourceFace':int(i),'vertices':triangle.tolist()} for i,triangle in enumerate(triangles) if root(raw_parent,int(triangle[0]))==root(raw_parent,vertex)]
    data['weldedClosure']=summary(closed_vertices)
    alias_closure=sorted({alias for i in raw_vertices for alias in aliases[welded[i]]})
    data['rawSheetAliasClosure']=summary(alias_closure)
    data['rawSheetAliasVertices']=alias_closure
    chain=sorted([(name,float(bones[name][1])) for name in ['Hips','Spine02','Spine01','Spine','neck']],key=lambda row:row[1])
    def height_field(y, cubic):
        if y<=chain[0][1]: return {chain[0][0]:1.0}
        for j in range(1,len(chain)):
            if y<=chain[j][1]:
                t=(y-chain[j-1][1])/(chain[j][1]-chain[j-1][1])
                if cubic:t=t*t*(3-2*t)
                return {chain[j-1][0]:1-t,chain[j][0]:t}
        return {chain[-1][0]:1.0}
    data['pureHeightFieldRows']=[vertex_report(i)|{'linear':height_field(positions[i,1],False),'smooth':height_field(positions[i,1],True)} for i in alias_closure]
    closure_set=set(alias_closure);border=[];edge_seen=set()
    for triangle in triangles:
        a,b,c=map(int,triangle)
        for a,b in [(a,b),(b,c),(c,a)]:
            key=tuple(sorted([a,b]))
            if key in edge_seen or (a in closure_set)==(b in closure_set):continue
            edge_seen.add(key)
            row={'vertices':[a,b],'restLength':float(np.linalg.norm(positions[a]-positions[b])),'sourceEnds':[vertex_report(a),vertex_report(b)]}
            for mode,cubic in [('linear',False),('smooth',True)]:
                ends=[height_field(positions[v,1],cubic) if v in closure_set else influences(v) for v in [a,b]]
                row[mode+'WeightGap']=sum(abs(ends[0].get(name,0)-ends[1].get(name,0)) for name in names)
            row['originalWeightGap']=sum(abs(influences(a).get(name,0)-influences(b).get(name,0)) for name in names)
            border.append(row)
    data['aliasClosureBoundaryMath']=border

    edge_use=defaultdict(int)
    for triangle in triangles:
        if root(raw_parent,int(triangle[0]))!=root(raw_parent,vertex): continue
        a,b,c=map(int,triangle)
        for a,b in [(a,b),(b,c),(c,a)]: edge_use[tuple(sorted([a,b]))]+=1
    data['rawSheetBoundary']=[{'vertices':[a,b],'restLength':float(np.linalg.norm(positions[a]-positions[b])),'ends':[vertex_report(a),vertex_report(b)]} for (a,b),use in edge_use.items() if use==1]
    data['rawSheetSeamAliases']=[{'vertex':i,'outsideAliases':[vertex_report(alias) for alias in aliases[welded[i]] if alias not in set(raw_vertices)]} for i in raw_vertices if any(alias not in set(raw_vertices) for alias in aliases[welded[i]])]

    rings=[{welded[vertex]}]
    for _ in range(3): rings.append(rings[-1]|{near for cell in rings[-1] for near in adjacency[cell]})
    data['rings']=[{'hops':hops,'vertices':[vertex_report(i) for cell in sorted(ring) for i in aliases[cell]]} for hops,ring in enumerate(rings)]
    component=set(closed_vertices)
    roi={i for i in component if abs(positions[i,0]-bones['Hips'][0])<.19 and 1.1<positions[i,1]<1.4}
    data['diagnosticCentralTorsoROI']=summary(sorted(roi))
    data['diagnosticROIVertices']=sorted(roi)
    boundary=[]; seen=set()
    for triangle in triangles:
        a,b,c=map(int,triangle)
        for a,b in [(a,b),(b,c),(c,a)]:
            key=tuple(sorted([a,b]))
            if (a in roi)!=(b in roi) and key not in seen:
                seen.add(key);boundary.append({'vertices':[a,b],'restLength':float(np.linalg.norm(positions[a]-positions[b])),'ends':[vertex_report(a),vertex_report(b)]})
    data['diagnosticROIBoundary']=boundary
    report['targets'].append(data)
report['allComponents']=[summary(vertices)|{'component':component} for component,vertices in components.items()]
output=PROJECT.parent/'artifacts/glory-overnight/frost-chest-source-diagnosis.json'
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,ensure_ascii=False,indent=2))
for target in report['targets']:
    print(json.dumps({key:target[key] for key in ['vertex','position','weights','aliases','rawSheetInfo','weldedClosure','diagnosticCentralTorsoROI']},ensure_ascii=False))
print('Saved source-only index/duplicate/rings/ROI boundary evidence:',output)
