# 田字格 · 拼音田字格（iPad 网页应用）

输入汉字 → 自动排进田字格 / 拼音田字格，孩子照着在本子上写。

- 拼音：pinyin-pro（按词语判断多音字，“一、不”变调可开关）；点任意字可改读音，数字标调输入（zhao1、lv4）
- 字体：汉字 FandolKai（楷体，GB 规范字形）；拼音 Andika（单层 ɑ、ɡ，接近课本拼音字形）
- 模式：拼音田字格 / 田字格，田字 / 米字，全部显示 / 看拼音写字 / 看字写拼音，三种格线颜色，打印
- 数字：0–9 按幼儿园写法设计字形和笔顺（4、5 两笔，其余一笔），配儿歌
- 笔顺页（点任意字/数字）：看一看（整字演示）、逐笔学、描一描（手指描写，写错提示）、笔顺分解图、语音朗读“第几笔，什么笔画”
- 自由练习：出一个字，孩子在大格子里用手指或 Apple Pencil 自己写，不提示、不判对错；“描着写”（淡红字垫底）/“照着写”（空格子看范字）；
  写好一遍存一遍，写够遍数（默认 3）自动换字，最后出“作业本”给家长看；用笔时自动忽略手掌；记录存在本机
- 离线：通过 HTTPS 打开一次并“添加到主屏幕”后，断网可用。sw.js 分两份缓存：程序文件改了就把 CORE_CACHE 版本号加一；
  笔顺数据只有重新生成 data/strokes 时才改 DATA_CACHE（否则用户每次升级都要重下 30MB）

## 数据
- 汉字笔顺：hanzi-writer-data（Make Me a Hanzi，9574 字），`node tools/build-strokes.mjs` 生成 data/strokes/00–63.json
- 笔画名称：cnchar-order，经 build-strokes.mjs 校正（竖折/竖弯、横钩/横撇、斜钩/卧钩、横折弯钩/横斜钩、虫的提、牙的竖折），内置 37 字人工校验
- 数字：`.venv-tools/bin/python tools/digits.py` 生成 data/digits.json（需 shapely）

## 测试
    node e2e/run.mjs              # WebKit 模拟 iPad Pro 11（68 项），产物 e2e/out/*.png + report.json
    BASE_URL=https://laoshe-git.github.io/tianzige/ node e2e/run.mjs   # 测线上版本
    node e2e/upgrade.mjs <旧提交>  # 模拟从旧版本升级：缓存接管、笔顺数据不重下、断网可用
    node e2e/make-icons.mjs # 重新生成图标

## 授权
授权原文见 licenses/。FandolKai：GPL v3 + 字体例外；Andika：SIL OFL 1.1；pinyin-pro、hanzi-writer、cnchar：MIT；hanzi-writer-data：Arphic Public License。
