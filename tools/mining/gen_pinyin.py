# -*- coding: utf-8 -*-
"""生成 js/data-pinyin.js —— 检索字段用字的字级拼音表（搜索的拼音键）。
收字范围＝search.js 建索引用到的字段：events 的 n/w/ya/b、data-*.js 的
n/t/p/wk、dynasties.js 的政权名。多音字取 pypinyin 常读。"""
import io,re,glob,os
from pypinyin import lazy_pinyin
ROOT=r"C:/Users/ziyi_/Claude/imperial-longevity"
strings=set()
ev=io.open(os.path.join(ROOT,'js/events.js'),encoding='utf-8').read()
for m in re.finditer(r"\b(?:n|w|ya|b)\s*:\s*'([^']+)'",ev): strings.add(m.group(1))
for f in glob.glob(os.path.join(ROOT,'js/data-*.js')):
    if 'pinyin' in f: continue
    s=io.open(f,encoding='utf-8').read()
    for m in re.finditer(r"\b(?:n|t|p|wk)\s*:\s*'([^']+)'",s): strings.add(m.group(1))
dyn=io.open(os.path.join(ROOT,'js/dynasties.js'),encoding='utf-8').read()
for m in re.finditer(r"D\('[a-z_]+',\s*'([^']+)'",dyn): strings.add(m.group(1))
chars=set()
for s in strings:
    for ch in s:
        if '\u3400'<=ch<='\u9fff': chars.add(ch)
pairs=[]
for ch in sorted(chars):
    py=lazy_pinyin(ch)[0]
    if re.fullmatch(r'[a-z]+',py): pairs.append((ch,py))
lines=["// data-pinyin.js —— 检索字段用字的字级拼音表。**由 tools/mining/gen_pinyin.py 生成**，手改会被覆盖。",
       "// 多音字取 pypinyin 常读（搜索容错场景，不追注音正确性）；search.js 据此为每个键生成全拼＋首字母。",
       "export default {"]
row=[]
for ch,py in pairs:
    row.append("'%s':'%s'"%(ch,py))
    if len(row)==16: lines.append('  '+','.join(row)+','); row=[]
if row: lines.append('  '+','.join(row)+',')
lines.append('};')
io.open(os.path.join(ROOT,'js/data-pinyin.js'),'w',encoding='utf-8',newline='\n').write('\n'.join(lines)+'\n')
print('chars: %d'%len(pairs))
