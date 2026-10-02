"""Combine the two views from the baseline and final pilot recordings on Mini."""
import argparse
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
p=argparse.ArgumentParser();p.add_argument('before',type=Path);p.add_argument('after',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
inputs=[a.before/'tp.mp4',a.after/'tp.mp4',a.before/'fp.mp4',a.after/'fp.mp4']
labels=['DEFAULT / THIRD PERSON','PILOT / THIRD PERSON','DEFAULT / FIRST PERSON','PILOT / FIRST PERSON']
filters=[]
overlay=Image.new('RGBA',(1920,1080));draw=ImageDraw.Draw(overlay);font=ImageFont.load_default(size=24)
for i,label in enumerate(labels):
    filters.append(f'[{i}:v]scale=960:540[v{i}]')
    x,y=(i%2)*960+18,(i//2)*540+14
    draw.rectangle((x-8,y-6,x+370,y+34),fill=(0,0,0,170));draw.text((x,y),label,font=font,fill='white')
overlay_path=a.output.with_suffix('.labels.png');overlay.save(overlay_path)
filters+=['[v0][v1]hstack=inputs=2[top]','[v2][v3]hstack=inputs=2[bottom]','[top][bottom]vstack=inputs=2[grid]','[grid][4:v]overlay=shortest=1[out]']
cmd=['ffmpeg','-loglevel','error','-y']
for file in inputs:cmd+=['-i',str(file)]
cmd+=['-loop','1','-i',str(overlay_path)]
a.output.parent.mkdir(parents=True,exist_ok=True)
cmd+=['-filter_complex',';'.join(filters),'-map','[out]','-an','-c:v','h264_videotoolbox','-b:v','12M','-pix_fmt','yuv420p',str(a.output)]
subprocess.run(cmd,check=True)
print(a.output)
