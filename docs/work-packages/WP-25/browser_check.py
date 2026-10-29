"""仅启动临时合成后端和本地生产构建，检查归档说明与原有登录/项目流程。"""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright

from verify import BASIC, EVIDENCE, ROOT, binding, test_environment


def wait_url(url, process):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"本轮服务提前退出：{url}，code={process.returncode}")
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"等待本轮服务超时：{url}")


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--backend", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--label", required=True)
    args = parser.parse_args()
    source = binding(args.source_ref, args.backend)
    frontend = ROOT / BASIC / "frontend"
    for port in (8100, 5180):
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"已有进程监听回环端口 {port}；不停止或复用外部服务")
    records, errors = [], []
    env = test_environment(args.backend)
    dist = {str(p.relative_to(frontend)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted((frontend / "dist").rglob("*")) if p.is_file()}
    if "dist/index.html" not in dist:
        raise RuntimeError("请先构建前端")
    with ExitStack() as stack:
        for name, command, cwd, url in [
            ("backend", [str(args.python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8100"], args.backend, "http://127.0.0.1:8100/api/health"),
            ("frontend", [str(frontend / "node_modules/.bin/vite"), "preview", "--host", "127.0.0.1", "--port", "5180", "--strictPort"], frontend, "http://127.0.0.1:5180/"),
        ]:
            handle = stack.enter_context((EVIDENCE / f"{args.label}-{name}.log").open("x"))
            handle.write(json.dumps({"command": command, "cwd": str(cwd)}, ensure_ascii=False) + "\n")
            handle.flush()
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=handle,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            stack.callback(stop, process)
            wait_url(url, process)
        playwright = stack.enter_context(sync_playwright())
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", headless=True)
        stack.callback(browser.close)
        for width in (375, 768, 1440):
            context = browser.new_context(viewport={"width": width, "height": 900})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto("http://127.0.0.1:5180/")
            notice = page.get_by_role("region", name="基础版使用范围与主线指引")
            expect(notice).to_be_visible()
            expect(notice.get_by_text("新业务请使用项目经营管理主线。", exact=True)).to_be_visible()
            guide = notice.get_by_role("link", name="查看主线启动指南 ↗")
            expect(guide).to_have_attribute("href", "https://github.com/xhc144/guanheng-workspace/blob/integration/systems/project-ops/README.md")
            expect(guide).to_have_attribute("rel", "noreferrer")
            # 键盘可展开说明，不访问外部站点。
            toggle = notice.locator("summary")
            toggle.focus()
            page.keyboard.press("Enter")
            expect(notice.get_by_text("这里保留基础版原有功能", exact=False)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            password = page.locator('input[name="password"]')
            password.fill("wrong-password")
            with page.expect_response(lambda r: r.url.endswith("/api/auth/login")) as response:
                page.get_by_role("button", name="登录", exact=True).click()
            assert response.value.status == 401
            expect(page.get_by_text("用户名或密码错误", exact=True)).to_be_visible()
            assert password.input_value() == "wrong-password"
            password.fill("Admin@123456")
            with page.expect_response(lambda r: r.url.endswith("/api/auth/login")) as response:
                page.get_by_role("button", name="登录", exact=True).click()
            assert response.value.status == 200
            expect(page.get_by_role("button", name="退出登录", exact=True)).to_be_visible()
            assert page.evaluate("Boolean(localStorage.getItem('pms.access_token'))")
            expect(notice).to_be_visible()
            page.get_by_role("button", name="项目管理", exact=True).click()
            expect(page.get_by_role("heading", name="项目管理", exact=True)).to_be_visible()
            code = f"BROWSER-{args.label}-{width}"
            page.get_by_placeholder("项目编码", exact=True).fill(code)
            page.get_by_placeholder("项目名称", exact=True).fill("合成浏览器回归项目")
            with page.expect_response(lambda r: r.url.endswith("/api/projects") and r.request.method == "POST") as response:
                page.get_by_role("button", name="创建项目", exact=True).click()
            assert response.value.status == 200
            expect(page.get_by_role("cell", name=code, exact=True)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path=f"/tmp/{args.label}-{width}.png", full_page=True)
            page.get_by_role("button", name="退出登录", exact=True).click()
            expect(page.get_by_role("button", name="登录", exact=True)).to_be_visible()
            expect(notice).to_be_visible()
            assert page.evaluate("localStorage.getItem('pms.access_token')") is None
            records.append({"width": width, "notice_before_after_login": "passed",
                            "keyboard_details": "passed", "login_401_then_200": "passed",
                            "create_project": "passed", "logout": "passed", "horizontal_overflow": False})
            context.close()
    assert not errors, errors
    binding(args.source_ref, args.backend)
    print(json.dumps({"binding": source, "built_files": dist, "checks": records,
                      "page_errors": errors, "external_links_opened": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
