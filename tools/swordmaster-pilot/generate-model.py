import os, sys, time
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
import torch
torch.cuda.set_per_process_memory_fraction(0.92)
from PIL import Image
from trellis2.pipelines import Trellis2ImageTo3DPipeline
import o_voxel
import types
import flex_gemm.kernels as _K
def _iws_fwd(feats, indices, weight):
    M, V = indices.shape
    C = feats.shape[1]
    out = torch.empty((M, C), device=feats.device, dtype=feats.dtype)
    step = 1 << 18
    for a in range(0, M, step):
        idx = indices[a:a+step].long()
        valid = (idx >= 0) & (idx < feats.shape[0])
        g = feats[idx.clamp(0, feats.shape[0] - 1)]
        w = (weight[a:a+step] * valid).unsqueeze(-1).to(g.dtype)
        out[a:a+step] = (g.float() * w.float()).sum(1).to(feats.dtype)
    return out
if not hasattr(_K, "triton"):
    _K.triton = types.SimpleNamespace(indice_weighed_sum_fwd=_iws_fwd)
src, out = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
tex = int(sys.argv[4]) if len(sys.argv) > 4 else 2048
t0 = time.time()
pipeline = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
pipeline.cuda()
print("loaded", time.time() - t0, flush=True)
image = Image.open(src)
mesh = pipeline.run(image, seed=seed, pipeline_type='1536_cascade')[0]
mesh.simplify(16777216)
print("generated", time.time() - t0, flush=True)
glb = o_voxel.postprocess.to_glb(
    vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
    attr_layout=mesh.layout, voxel_size=mesh.voxel_size,
    aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
    decimation_target=100000, texture_size=tex, remesh=True, remesh_band=1, remesh_project=0, verbose=True)
glb.export(out, extension_webp=False)
print("GEN_OK", out, time.time() - t0, flush=True)
