#!/bin/sh
# 真·JS 语法检查。node --check 对 .js 后缀里的 ESM 会静默放行（exit 0 不检查），
# 复制成 .mjs 才真的解析——本项目为此吃过一次哑亏（sections-panorama 丢逗号，
# --check 说没事，浏览器白屏）。用法：sh tools/lint-js.sh
NODE="/c/Program Files/nodejs/node.exe"
T="${TMP:-/tmp}/il-lintjs.mjs"
bad=0
for f in js/*.js; do
  cp "$f" "$T"
  if ! "$NODE" --check "$T" 2>/tmp/il-lintjs.err; then
    echo "✗ $f"; sed -n '1,6p' /tmp/il-lintjs.err; bad=1
  fi
done
[ "$bad" = 0 ] && echo "JS 语法全过（真查）"
exit $bad
