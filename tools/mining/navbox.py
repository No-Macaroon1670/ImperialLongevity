# -*- coding: utf-8 -*-
"""从中文维基「中國歷史事件」导航模板族里抓候选事件。

此前几轮是按 Category:X世纪中国 爬的——分类页按年代切,一个事件挂在哪一年
全看编者心情,漏得厉害。导航模板反过来:每个朝代一张表,把该朝有条目的事件
一网打尽(《元朝历史》一张表就有二百余项),正是我们要的全集。

本脚本只做「取全集 + 减去已有」,不做取舍——取舍交给 agent 逐条核年份。
抓下来的清单写进 nav_<朝代>.txt。

维基对匿名请求限流较严(实测连发数十次即 429),故 0.6s 间隔 + 指数退避。
"""
import io, json, os, re, time, urllib.parse, urllib.request

ROOT = r"C:/Users/ziyi_/Claude/imperial-longevity"
HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "ImperialLongevity/1.0 (timeline research)"}

def api(**kw):
    kw.setdefault("format", "json")
    kw.setdefault("action", "query")
    url = "https://zh.wikipedia.org/w/api.php?" + urllib.parse.urlencode(kw)
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40)
            time.sleep(0.6)
            return json.load(r)
        except Exception as ex:
            wait = 3 * (attempt + 1)
            print("   retry %d (%s) 等 %ds" % (attempt + 1, repr(ex)[:60], wait))
            time.sleep(wait)
    return None

# 已有条目名(去重用;真正的判重在 pid.py 里按 pageid 做)
src = io.open(os.path.join(ROOT, "js/events.js"), encoding="utf-8").read()
have = set(re.findall(r"w: '([^']+)'", src)) | set(re.findall(r"n: '([^']+)'", src))
dsrc = io.open(os.path.join(ROOT, "js/dynasties.js"), encoding="utf-8").read()
have |= set(re.findall(r"D\('[a-z_]+',\s*'([^']+)'", dsrc))
have |= set(re.findall(r"w: '([^']+)'", dsrc))
print("已有 %d 个名字用于初筛" % len(have))

# 实名取自 ns10 搜索,繁简混用照抄,不要自己改写
CANDS = [
    ("prehan", ["Template:中國傳疑時代歷史事件", "Template:上古三代歷史事件",
                "Template:春秋歷史事件", "Template:戰國歷史事件"]),
    ("qinhan", ["Template:秦朝歷史事件", "Template:漢朝歷史事件"]),
    ("weijin", ["Template:三國歷史事件", "Template:晉朝歷史事件",
                "Template:五胡十六國歷史事件", "Template:南北朝歷史事件",
                "Template:隋朝歷史事件"]),
    ("tang",   ["Template:唐朝歷史事件", "Template:五代十國歷史事件"]),
    ("song",   ["Template:宋朝历史事件", "Template:遼金夏歷史事件",
                "Template:元朝歷史事件"]),
    ("mingqing", ["Template:明朝歷史事件", "Template:清朝歷史事件"]),
]

for group, tmpls in CANDS:
    rows, ok = [], []
    for t in tmpls:
        print("抓", t)
        d = api(prop="links", titles=t, pllimit="500", plnamespace="0", redirects="1")
        if not d:
            print("   × 失败"); continue
        pages = list(d["query"]["pages"].values())
        if any("missing" in p for p in pages):
            print("   × 无此模板"); continue
        links = [l["title"] for p in pages for l in p.get("links", [])]
        # 续页
        cont = d.get("continue", {}).get("plcontinue")
        while cont:
            d2 = api(prop="links", titles=t, pllimit="500", plnamespace="0",
                     redirects="1", plcontinue=cont)
            if not d2: break
            links += [l["title"] for p in d2["query"]["pages"].values() for l in p.get("links", [])]
            cont = d2.get("continue", {}).get("plcontinue")
        ok.append("%s(%d)" % (t, len(links)))
        rows += links
    # 初筛:去掉已有的、去掉明显非事件的(人物列表、朝代名、模板杂项)
    drop_re = re.compile(r"(列表|年表|君主|皇帝$|世系|历史$|歷史$|文化$|军事$|軍事$|经济$|經濟$)")
    fresh = sorted({r for r in rows if r not in have and not drop_re.search(r)})
    io.open(os.path.join(HERE, "nav_%s.txt" % group), "w", encoding="utf-8").write("\n".join(fresh))
    print("== %s: 模板 %s → 链接 %d,去已有与噪声后 %d 条 → nav_%s.txt"
          % (group, " ".join(ok), len(rows), len(fresh), group))
