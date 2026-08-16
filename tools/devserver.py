# 开发服务器:python -m http.server 的替身,唯一区别是发 Cache-Control: no-cache。
# 裸 http.server 不发缓存头,浏览器对 JS/CSS 走「启发式缓存」(新鲜期≈文件年龄的
# 10%),改完代码立刻刷新常拿到旧体——本项目多次被它坑出"改动无效"的假象。
# no-cache 逼浏览器每次带 If-Modified-Since 回源,未改的文件仍走 304,不牺牲速度。
# 生产(GitHub Pages)自带正确的缓存头,与此无关。
import functools
import http.server
import os
import sys

# 服务根固定取「本脚本的上级目录」＝项目根,不看进程的当前目录:
# 预览进程的 cwd 可能是仓库上级(实测如此),按相对路径既找不到脚本、
# 也会把上级目录当成站点根
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4190
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    print(f'serving {ROOT} on :{port} (Cache-Control: no-cache)', flush=True)
    http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
