#!/usr/bin/env python3
# 把写实多阶段植物归一化为「统一画布 + 底部对齐 + relH 缩放」的杂草帧，
# 与 field.ts 的 stageRel(i,N)=0.32+0.68*(i/(N-1))^0.8 同公式 → 接入 drawWeed 后换阶段不跳大小、连续生长。
# 用法：python3 normplant.py
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'newbg')
H_CANVAS = 600  # 统一画布高（hero 植物保细节）

def rel_h(i, n):
    return 0.32 + 0.68 * pow(i / (n - 1), 0.8) if n > 1 else 1.0

def trim(im):
    bbox = im.getbbox()  # 非透明包围盒
    return im.crop(bbox) if bbox else im

def normalize(prefix, stage_files, out_prefix):
    imgs = []
    for f in stage_files:
        p = os.path.join(ROOT, f + '.png')
        imgs.append(trim(Image.open(p).convert('RGBA')))
    n = len(imgs)
    # 先算每阶段缩放后内容尺寸，取最大宽 → 统一画布宽
    scaled = []
    max_w = 1
    for i, im in enumerate(imgs):
        target_h = rel_h(i, n) * H_CANVAS
        s = target_h / im.height
        sw, sh = max(1, round(im.width * s)), max(1, round(im.height * s))
        scaled.append((sw, sh))
        max_w = max(max_w, sw)
    W = max_w + 8  # 两侧留 4px 余量
    out = []
    for i, im in enumerate(imgs):
        sw, sh = scaled[i]
        rim = im.resize((sw, sh), Image.LANCZOS)
        canvas = Image.new('RGBA', (W, H_CANVAS), (0, 0, 0, 0))
        x = (W - sw) // 2          # 水平居中
        y = H_CANVAS - sh          # 底部对齐
        canvas.alpha_composite(rim, (x, y))
        op = os.path.join(ROOT, f'{out_prefix}_{i}.png')
        canvas.save(op)
        out.append(f'{out_prefix}_{i} ({sw}x{sh} -> {W}x{H_CANVAS}, relH={rel_h(i,n):.3f})')
    print(f'[{prefix}] canvas {W}x{H_CANVAS}, {n} stages:')
    for o in out:
        print('   ', o)

# plant1 酸模(高挺)：4 生长帧 + dry 枯萎帧
normalize('plant1', ['newplant-baby', 'newplant-young', 'newplant-before-flower', 'newplant-flower', 'newplant-dry'], 'np1')
# plant2 蛇莓(矮铺)：4 生长帧 + dry 枯萎帧
normalize('plant2', ['newplant2-baby', 'newplant2-young', 'newplant2-before-flower', 'newplant2-flower', 'newplant2-dry'], 'np2')
print('done')
