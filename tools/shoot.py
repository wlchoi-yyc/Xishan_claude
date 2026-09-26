# 用 Playwright 為人物預覽頁截圖：python3 tools/shoot.py out_dir view1 view2 ...
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright
out = sys.argv[1]; views = sys.argv[2:] or ['lineup']
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765'], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page(viewport={'width': 1400, 'height': 800})
        pg.on('console', lambda m: print('console:', m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: print('pageerror:', e))
        for v in views:
            pg.goto(f'http://localhost:8765/tools/people-preview.html?view={v}')
            pg.wait_for_function('window.__ready === true', timeout=60000)
            time.sleep(0.3)
            name = v.replace('&', '_').replace('=', '-')
            pg.screenshot(path=f'{out}/{name}.png')
            print('saved', name)
        b.close()
finally:
    srv.terminate()
