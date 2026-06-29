#!/usr/bin/env python3
# 把新写实小麦整株图归一化为旧版「统一画布 + 每阶段按生长曲线占高 + 底部对齐」的 5 张阶段图，
# 直接覆盖 assets/plant_wheat_s1..s5.png → 标准作物管线零改动接入(crossfade/gScale/CROP_BOTTOM 0.994 不变)。
# fillH 曲线沿用旧小麦实测值，保证生长大小连续。
import os
from PIL import Image

A = os.path.join(os.path.dirname(__file__), '..', '..', 'assets')
NW = os.path.join(A, 'newwheat')
H = 720
ROOT_Y = 0.994  # 根线锚点(与 CROP_BOTTOM.wheat 一致)：内容底边对齐到此
# 阶段 → (源图, 占画布高比例 fillH)  —— 映射: 幼苗→分蘖→抽穗→成熟→成熟(稍大)
STAGES = [
    (os.path.join(NW, 'plant_wheat_baby.png'), 0.21),
    (os.path.join(NW, 'plant_wheat_grow.png'), 0.37),
    (os.path.join(A, 'plant_wheat_tasselout.png'), 0.60),
    (os.path.join(NW, 'plant_wheat_marture.png'), 0.83),
    (os.path.join(NW, 'plant_wheat_marture.png'), 0.97),
]

def trim(im):
    bb = im.getbbox()
    return im.crop(bb) if bb else im

imgs = [(trim(Image.open(p).convert('RGBA')), fill) for p, fill in STAGES]
# 统一画布宽 = 最宽阶段缩放后宽度 + 余量
scaled = []
maxw = 1
for im, fill in imgs:
    th = fill * H
    s = th / im.height
    sw, sh = max(1, round(im.width * s)), max(1, round(im.height * s))
    scaled.append((sw, sh)); maxw = max(maxw, sw)
W = maxw + 10
bottom = round(ROOT_Y * H)
for i, ((im, fill), (sw, sh)) in enumerate(zip(imgs, scaled), start=1):
    rim = im.resize((sw, sh), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(rim, ((W - sw) // 2, bottom - sh))
    op = os.path.join(A, f'plant_wheat_s{i}.png')
    canvas.save(op)
    print(f'  s{i}: {sw}x{sh} -> {W}x{H} (fillH={fill})')

# —— 玉米式枯死/残茬帧 —— (dry 与 s5 同画布 → 交叉淡入对齐；stubble 矮；ear/leaf 紧裁供散布)
def bottom_frame(src, fill, name):  # 同 379x720 统一画布、底部对齐
    im = trim(Image.open(src).convert('RGBA'))
    th = fill * H; s = th / im.height
    sw, sh = max(1, round(im.width * s)), max(1, round(im.height * s))
    rim = im.resize((sw, sh), Image.LANCZOS)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(rim, ((W - sw) // 2, bottom - sh))
    canvas.save(os.path.join(A, name)); print(f'  {name}: fillH={fill} ({sw}x{sh})')

def trim_frame(src, name, maxdim):  # 紧裁(落穗/落叶散布用，居中锚点)
    im = trim(Image.open(src).convert('RGBA'))
    sc = maxdim / max(im.size)
    rim = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    rim.save(os.path.join(A, name)); print(f'  {name}: {rim.size}')

bottom_frame(os.path.join(NW, 'plant_wheat_dry.png'), 0.97, 'plant_wheat_dry.png')          # 站立枯(整株)
bottom_frame(os.path.join(NW, 'plant_wheat_drystubble.png'), 0.22, 'plant_wheat_stubble.png')  # 残茬(矮)
trim_frame(os.path.join(NW, 'plant_wheat_drywheatear.png'), 'plant_wheat_ear.png', 320)      # 落穗
trim_frame(os.path.join(NW, 'plant_wheat_deadLeave.png'), 'plant_wheat_leaf.png', 320)       # 落叶
print(f'done (canvas {W}x{H})')
