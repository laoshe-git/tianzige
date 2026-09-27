"""生成 0-9 的笔顺数据（Hanzi Writer 格式），输出 data/digits.json。

每个数字按幼儿园书写教法定义中心线：起笔点、行笔方向、笔画数。
设计坐标：1024×1024，y 向下，(0,0) 为左上角；数字高约占格子 2/3。
输出时换成 Hanzi Writer 坐标（y 向上，范围 -124..900）：y_data = 900 - y。
轮廓 = 中心线加粗（圆头圆角），用 shapely 计算。

运行：.venv-tools/bin/python tools/digits.py
"""
import json
import math
from pathlib import Path

from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

HALF_WIDTH = 36  # 笔画半宽


def arc(cx, cy, rx, ry, a0, a1, step=4):
    """椭圆弧，角度单位：度，屏幕坐标（y 向下），a0→a1 可正可负方向。"""
    n = max(2, int(abs(a1 - a0) / step))
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def cubic(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                    mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]))
    return pts


def line(p0, p1, step=40):
    n = max(1, int(math.dist(p0, p1) / step))
    return [(p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n) for i in range(n + 1)]


def join(*parts):
    pts = []
    for p in parts:
        for q in p:
            if not pts or math.dist(pts[-1], q) > 0.5:
                pts.append(q)
    return pts


T, B = 170, 850  # 顶、底

DIGITS = {
    # 从上面起笔，向左画圈，回到起点
    "0": [arc(512, 510, 185, 340, -90, -450)],
    # 从上往下一竖
    "1": [line((512, T), (512, B))],
    # 左上起笔，向右画弯，斜向左下，再写一横
    "2": [join(arc(512, 350, 185, 180, 195, 400),
               cubic((654, 465), (511, 631), (400, 760), (320, B)),
               line((320, B), (714, B)))],
    # 左上起笔，向右画两个半圆
    "3": [join(arc(500, 340, 175, 170, 215, 450),
               arc(500, 680, 195, 170, -95, 145))],
    # 第一笔：从上斜向左下，再向右写横（斜折）；第二笔：竖
    "4": [join(line((540, T), (300, 640)), line((300, 640), (744, 640))),
          line((630, T), (630, B))],
    # 第一笔：竖，再向右画大肚子（竖弯）；第二笔：上面一横
    "5": [join(line((372, T), (388, 472)), arc(500, 640, 195, 205, -125, 150)),
          line((372, T), (700, T))],
    # 右上起笔，向左下画弧，再画圈
    "6": [join(cubic((662, 215), (520, 150), (320, 300), (320, 660)),
               arc(505, 660, 185, 190, 180, -170))],
    # 先写横，再斜向左下
    "7": [join(line((320, T), (712, T)), line((712, T), (452, B)))],
    # 右上起笔，向左画弧，到下面画圈，再向右上回到起点
    "8": [join(arc(512, 335, 160, 165, -30, -270),
               arc(512, 680, 190, 170, -90, 270),
               arc(512, 335, 160, 165, 90, -30))],
    # 右上起笔，向左画圈，再在右边写竖
    "9": [join(arc(505, 345, 185, 175, -10, -370), line((687, 315), (690, B)))],
}

STROKE_NAMES = {"4": ["斜折", "竖"], "5": ["竖弯", "横"]}

READINGS = {  # 汉字读法与儿歌、口令
    "0": ("零", "líng", "0像鸡蛋做蛋糕", "从上面起笔，向左画一个圆圈，回到起点。"),
    "1": ("一", "yī", "1像铅笔细长条", "从上往下，写一竖。"),
    "2": ("二", "èr", "2像小鸭水中游", "从左上起笔，向右画弯，斜着向左下，最后写一横。"),
    "3": ("三", "sān", "3像耳朵听声音", "从左上起笔，向右画两个半圆。"),
    "4": ("四", "sì", "4像小旗迎风飘", "第一笔，从上往左下斜，再向右写横。第二笔，从上往下写竖。"),
    "5": ("五", "wǔ", "5像秤钩来买菜", "第一笔，先写竖，再向右画大肚子。第二笔，在上面写一横。"),
    "6": ("六", "liù", "6像哨子嘟嘟响", "从右上起笔，向左下画弧，再画一个圆圈。"),
    "7": ("七", "qī", "7像镰刀割青草", "先写横，再斜着向左下写。"),
    "8": ("八", "bā", "8像麻花拧一道", "从右上起笔，向左画弧，拐到下面画一个圈，再往右上回到起点。"),
    "9": ("九", "jiǔ", "9像勺子能盛饭", "从右上起笔，向左画一个圆圈，再在右边往下写竖。"),
}


# 分步语音：两笔的数字逐笔说，一笔写成的数字说整句口令
SAY = {
    "4": ["第一笔，从上往左下斜，再向右写横。", "第二笔，从上往下写竖。"],
    "5": ["第一笔，先写竖，再向右画大肚子。", "第二笔，在上面写一横。"],
}


def to_data(p):
    return (round(p[0]), round(900 - p[1]))


def ring_path(coords):
    pts = [to_data(p) for p in coords]
    return "M " + " L ".join(f"{x} {y}" for x, y in pts[:-1]) + " Z"


def outline(pts):
    shape = LineString(pts).buffer(HALF_WIDTH, quad_segs=8, cap_style="round", join_style="round")
    shape = shape.simplify(0.6)
    polys = list(shape.geoms) if shape.geom_type == "MultiPolygon" else [shape]
    parts = []
    for poly in polys:
        poly = Polygon(poly.exterior.coords, [r.coords for r in poly.interiors])
        # 屏幕坐标翻转后方向会反，外环逆时针、内环顺时针保证 nonzero 下有洞
        ext = list(poly.exterior.coords)
        parts.append(ring_path(ext))
        for r in poly.interiors:
            parts.append(ring_path(list(r.coords)))
    return " ".join(parts)


def medians(pts, step=48):
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += math.dist(a, b)
        if acc >= step:
            out.append(b)
            acc = 0.0
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return [list(to_data(p)) for p in out]


def main():
    data = {}
    for d, strokes in DIGITS.items():
        han, py, rhyme, how = READINGS[d]
        data[d] = {
            "s": [outline(s) for s in strokes],
            "m": [medians(s) for s in strokes],
            "n": STROKE_NAMES.get(d, ["一笔写成"] * len(strokes)),
            "han": han, "py": py, "rhyme": rhyme, "how": how,
            "say": SAY.get(d, [how]),
        }
    out = Path(__file__).resolve().parent.parent / "data" / "digits.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print("wrote", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
