#!/usr/bin/env python3
"""Skin a new (static, meter-scale, feet-on-ground) GLB with the existing Meshy rig.

python transfer_skin.py OLD_RIGGED.glb NEW_STATIC.glb OUT.glb
Copies skin weights from the old rigged mesh to the new mesh by nearest old vertices,
keeps the old skeleton/inverse-bind-matrices untouched, replaces mesh data and textures.
"""
import sys, io, struct
import numpy as np
from scipy.spatial import cKDTree
from pygltflib import GLTF2, Accessor, BufferView, Image, Texture, Material, Attributes
from PIL import Image as PILImage

OLD, NEW, OUT = sys.argv[1:4]
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_acc(g, blob, idx):
    a = g.accessors[idx]
    bv = g.bufferViews[a.bufferView]
    n = NC[a.type]
    dt = np.dtype(CT[a.componentType])
    stride = bv.byteStride or n * dt.itemsize
    base = (bv.byteOffset or 0) + (a.byteOffset or 0)
    if stride == n * dt.itemsize:
        arr = np.frombuffer(blob, dtype=dt, count=a.count * n, offset=base).reshape(a.count, n)
    else:
        arr = np.stack([np.frombuffer(blob, dtype=dt, count=n, offset=base + i * stride) for i in range(a.count)])
    return arr.copy()


def node_local(nd):
    if nd.matrix:
        return np.array(nd.matrix, dtype=np.float64).reshape(4, 4).T
    T = np.eye(4)
    S = np.eye(4)
    R = np.eye(4)
    if nd.translation:
        T[:3, 3] = nd.translation
    if nd.scale:
        S[0, 0], S[1, 1], S[2, 2] = nd.scale
    if nd.rotation:
        x, y, z, w = nd.rotation
        R[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return T @ R @ S


def world(g, target):
    parent = {}
    for i, nd in enumerate(g.nodes):
        for c in nd.children or []:
            parent[c] = i
    M = np.eye(4)
    i = target
    while True:
        M = node_local(g.nodes[i]) @ M
        if i not in parent:
            break
        i = parent[i]
    return M


old = GLTF2.load(OLD)
oblob = old.binary_blob()
mi = next(i for i, n in enumerate(old.nodes) if n.mesh is not None)
prim = old.meshes[old.nodes[mi].mesh].primitives[0]
Wm = np.eye(4)  # skinned mesh: node transform ignored; positions already metres
opos = read_acc(old, oblob, prim.attributes.POSITION).astype(np.float64)
oj = read_acc(old, oblob, prim.attributes.JOINTS_0).astype(np.int64)
ow = read_acc(old, oblob, prim.attributes.WEIGHTS_0).astype(np.float64)
if ow.dtype != np.float64:
    ow = ow.astype(np.float64)
if old.accessors[prim.attributes.WEIGHTS_0].componentType != 5126:
    ow = ow / np.iinfo(CT[old.accessors[prim.attributes.WEIGHTS_0].componentType]).max
opos_w = (np.c_[opos, np.ones(len(opos))] @ Wm.T)[:, :3]

new = GLTF2.load(NEW)
nblob = new.binary_blob()
nprim = new.meshes[0].primitives[0]
npos = read_acc(new, nblob, nprim.attributes.POSITION).astype(np.float64)
nnor = read_acc(new, nblob, nprim.attributes.NORMAL).astype(np.float64) if nprim.attributes.NORMAL is not None else None
nuv = read_acc(new, nblob, nprim.attributes.TEXCOORD_0).astype(np.float32)
nidx = read_acc(new, nblob, nprim.indices).astype(np.uint32).reshape(-1)
# apply the new file's own node transform (trimesh exports identity, but be safe)
nmi = next(i for i, n in enumerate(new.nodes) if n.mesh is not None)
Wn = world(new, nmi)
npos_w = (np.c_[npos, np.ones(len(npos))] @ Wn.T)[:, :3]

print('old bounds', opos_w.min(0).round(3), opos_w.max(0).round(3))
print('new bounds', npos_w.min(0).round(3), npos_w.max(0).round(3))



def face_project(base, npos, nnor, nuv, nidx, ref_path, top_frac=0.115, bot_frac=0.04, xlim=0.062):
    """Project the reference image's face onto front-facing head texels."""
    ref = PILImage.open(ref_path).convert('RGB')
    ra = np.asarray(ref).astype(np.float32)
    mask = ra.min(2) < 243
    ys, xs = np.where(mask)
    y0, y1 = ys.min(), ys.max()
    cx = (np.where(mask[int(y0 + 0.06 * (y1 - y0)):int(y0 + 0.25 * (y1 - y0))].any(0))[0])
    xc = 0.5 * (cx.min() + cx.max())  # head column centre in the reference
    H = npos[:, 1].max() - npos[:, 1].min()
    ppm = (y1 - y0) / H  # reference pixels per metre
    ytop = npos[:, 1].max()
    ybot = npos[:, 1].min()
    texa = np.asarray(base.convert('RGB')).astype(np.float32)
    TW0, TH0 = base.size
    vx = np.clip((nuv[:, 0] * TW0).astype(int), 0, TW0 - 1)
    vy = np.clip((nuv[:, 1] * TH0).astype(int), 0, TH0 - 1)
    luma = texa[vy, vx].mean(1)
    cand = (npos[:, 1] > ybot + 0.80 * H) & (npos[:, 1] < ybot + 0.97 * H) & (np.abs(npos[:, 0]) < 0.075) & (nnor[:, 2] > 0.4) & (luma < 45)
    cand &= npos[:, 2] > np.percentile(npos[:, 2][npos[:, 1] > ybot + 0.80 * H], 60)
    if cand.sum() >= 5:
        eye_y = float(np.median(npos[cand, 1]))
        eye_h = max(0.012, float(np.percentile(npos[cand, 1], 90) - np.percentile(npos[cand, 1], 10)))
    else:
        eye_y, eye_h = ybot + 0.92 * H, 0.02
    print('eye_y', round(eye_y, 3), 'frac', round((eye_y - ybot) / H, 3), 'n', int(cand.sum()), 'h', round(eye_h, 3))
    ymin = eye_y - 0.075
    ymax = eye_y + 0.06
    tex = np.asarray(base.convert('RGB')).astype(np.float32).copy()
    TW, TH = base.size
    tri = nidx.reshape(-1, 3)
    cy = npos[tri][:, :, 1].mean(1)
    nz = nnor[tri][:, :, 2].mean(1) if nnor is not None else np.ones(len(tri))
    sel = np.where((cy > ymin - 0.02) & (cy < ymax + 0.02) & (nz > 0.25))[0]
    hit = np.zeros((TH, TW), np.float32)
    acc = np.zeros((TH, TW, 3), np.float32)
    for f in sel:
        i0, i1, i2 = tri[f]
        uv = nuv[[i0, i1, i2]].astype(np.float64) * [TW, TH]
        mn = np.floor(uv.min(0)).astype(int) - 1
        mx = np.ceil(uv.max(0)).astype(int) + 1
        mn = np.maximum(mn, 0)
        mx = np.minimum(mx, [TW - 1, TH - 1])
        if mx[0] <= mn[0] or mx[1] <= mn[1]:
            continue
        gx, gy = np.meshgrid(np.arange(mn[0], mx[0] + 1) + 0.5, np.arange(mn[1], mx[1] + 1) + 0.5)
        P = np.stack([gx.ravel(), gy.ravel()], 1)
        a, b, c = uv
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (P[:, 0] - c[0]) + (c[0] - b[0]) * (P[:, 1] - c[1])) / den
        l2 = ((c[1] - a[1]) * (P[:, 0] - c[0]) + (a[0] - c[0]) * (P[:, 1] - c[1])) / den
        l3 = 1 - l1 - l2
        ok = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not ok.any():
            continue
        L = np.stack([l1[ok], l2[ok], l3[ok]], 1)
        X = L @ npos[[i0, i1, i2]]
        N = L @ nnor[[i0, i1, i2]]
        N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
        px = xc + X[:, 0] * ppm
        py = y1 - X[:, 1] * ppm + (npos[:, 1].min() * ppm)  # feet at y1
        inside = (px >= 0) & (px < ref.size[0] - 1) & (py >= 0) & (py < ref.size[1] - 1)
        col = np.zeros((len(px), 3), np.float32)
        x0 = np.clip(px.astype(int), 0, ref.size[0] - 2)
        yy0 = np.clip(py.astype(int), 0, ref.size[1] - 2)
        fx = (px - x0)[:, None]
        fy = (py - yy0)[:, None]
        col = (ra[yy0, x0] * (1 - fx) * (1 - fy) + ra[yy0, x0 + 1] * fx * (1 - fy) + ra[yy0 + 1, x0] * (1 - fx) * fy + ra[yy0 + 1, x0 + 1] * fx * fy)
        w = np.clip((N[:, 2] - 0.35) / 0.4, 0, 1) * inside
        fy_ = np.clip((X[:, 1] - ymin) / (0.012 * H), 0, 1) * np.clip((ymax - X[:, 1]) / (0.012 * H), 0, 1)
        fx_ = np.clip((xlim - np.abs(X[:, 0])) / 0.015, 0, 1)
        w *= fy_ * fx_
        gxi = (P[ok][:, 0] - 0.5).astype(int)
        gyi = (P[ok][:, 1] - 0.5).astype(int)
        better = w > hit[gyi, gxi]
        acc[gyi[better], gxi[better]] = col[better]
        hit[gyi[better], gxi[better]] = w[better]
    out = tex * (1 - hit[..., None]) + acc * hit[..., None]
    return PILImage.fromarray(np.clip(out, 0, 255).astype(np.uint8))

# --- weight transfer
K = 8
tree = cKDTree(opos_w)
d, nn = tree.query(npos_w, k=K)
d = np.maximum(d, 1e-5)
inv = 1.0 / d ** 2
nj = np.zeros((len(npos_w), 4), dtype=np.uint16)
nw = np.zeros((len(npos_w), 4), dtype=np.float32)
for v in range(len(npos_w)):
    acc = {}
    for k in range(K):
        o = nn[v, k]
        for s in range(4):
            if ow[o, s] > 0:
                acc[oj[o, s]] = acc.get(oj[o, s], 0.0) + ow[o, s] * inv[v, k]
    top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
    tot = sum(x for _, x in top) or 1.0
    for s, (j, x) in enumerate(top):
        nj[v, s] = j
        nw[v, s] = x / tot
print('mean nn dist', float(d[:, 0].mean()), 'max', float(d[:, 0].max()))

# --- back into the old mesh node's local space
Wi = np.linalg.inv(Wm)
lpos = (np.c_[npos_w, np.ones(len(npos_w))] @ Wi.T)[:, :3].astype(np.float32)
if nnor is not None:
    Nm = np.linalg.inv(Wi[:3, :3]).T
    lnor = nnor @ Nm.T
    lnor /= np.maximum(np.linalg.norm(lnor, axis=1, keepdims=True), 1e-9)
    lnor = lnor.astype(np.float32)
else:
    lnor = None

# --- textures from the new file
def img_bytes(g, blob, tex_index, fmt):
    im = g.images[g.textures[tex_index].source]
    bv = g.bufferViews[im.bufferView]
    raw = blob[(bv.byteOffset or 0):(bv.byteOffset or 0) + bv.byteLength]
    p = PILImage.open(io.BytesIO(raw))
    return p


nm = new.materials[nprim.material]
base_img = img_bytes(new, nblob, nm.pbrMetallicRoughness.baseColorTexture.index, 'png')
mr_img = None
if nm.pbrMetallicRoughness.metallicRoughnessTexture is not None:
    mr_img = img_bytes(new, nblob, nm.pbrMetallicRoughness.metallicRoughnessTexture.index, 'png')

# --- assemble: append data to the old blob
buf = bytearray(oblob)


def add(data, target=None):
    while len(buf) % 4:
        buf.append(0)
    off = len(buf)
    buf.extend(data)
    old.bufferViews.append(BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
    return len(old.bufferViews) - 1


def acc(bv, count, ctype, typ, mn=None, mx=None):
    old.accessors.append(Accessor(bufferView=bv, componentType=ctype, count=count, type=typ, min=mn, max=mx))
    return len(old.accessors) - 1


a_pos = acc(add(lpos.tobytes(), 34962), len(lpos), 5126, 'VEC3', lpos.min(0).tolist(), lpos.max(0).tolist())
a_nor = acc(add(lnor.tobytes(), 34962), len(lnor), 5126, 'VEC3') if lnor is not None else None
a_uv = acc(add(nuv.tobytes(), 34962), len(nuv), 5126, 'VEC2')
a_j = acc(add(nj.tobytes(), 34962), len(nj), 5123, 'VEC4')
a_w = acc(add(nw.tobytes(), 34962), len(nw), 5126, 'VEC4')
a_i = acc(add(nidx.tobytes(), 34963), len(nidx), 5125, 'SCALAR')
prim.attributes = Attributes(POSITION=a_pos, NORMAL=a_nor, TEXCOORD_0=a_uv, JOINTS_0=a_j, WEIGHTS_0=a_w)
prim.indices = a_i


def add_image(pil, mime, **kw):
    b = io.BytesIO()
    pil.save(b, format=mime, **kw)
    bv = add(b.getvalue())
    old.images.append(Image(bufferView=bv, mimeType='image/' + mime.lower()))
    old.textures.append(Texture(source=len(old.images) - 1))
    return len(old.textures) - 1


REF = sys.argv[4] if len(sys.argv) > 4 else None
if REF:
    base_img = face_project(base_img, npos_w, nnor, nuv, nidx, REF)
    base_img.save(OUT.replace('.glb', '_basecolor.png'))
t_base = add_image(base_img.convert('RGB'), 'JPEG', quality=93)
mat = old.materials[prim.material if prim.material is not None else 0]
mat.pbrMetallicRoughness.baseColorTexture.index = t_base
mat.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]
if mr_img is not None:
    t_mr = add_image(mr_img.convert('RGB'), 'PNG')
    from pygltflib import TextureInfo
    mat.pbrMetallicRoughness.metallicRoughnessTexture = TextureInfo(index=t_mr)
    mat.pbrMetallicRoughness.metallicFactor = 1.0
    mat.pbrMetallicRoughness.roughnessFactor = 1.0
mat.doubleSided = False
mat.emissiveFactor = [0, 0, 0]
mat.emissiveTexture = None
mat.occlusionTexture = None
mat.normalTexture = None
mat.extensions = {}
mat.alphaMode = 'OPAQUE'
old.buffers[0].byteLength = len(buf)
old.set_binary_blob(bytes(buf))
old.save_binary(OUT)
print('saved', OUT, len(buf) / 1e6, 'MB')
