import assert from "node:assert/strict";
import test from "node:test";
import { GET, HEAD } from "../app/favicon.ico/route.ts";
import { faviconMetadata, getBasePath, withBasePath } from "../lib/base-path.ts";

test("favicon的真实GET/HEAD响应为204、零字节且不创建会话或图片类型", async () => {
  for (const method of [GET, HEAD]) {
    const response = method();
    assert.equal(response.status, 204);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    assert.equal(response.body, null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("content-type"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

test("默认及/pms图标元数据href解析为本部署204路径，添加前缀幂等", () => {
  for (const basePath of ["", "/pms", "/pms/v2"]) {
    const metadata = faviconMetadata(basePath), href = metadata.icons.icon[0].url;
    assert.equal(new URL(href, "http://127.0.0.1:4000").pathname, `${basePath}/favicon.ico`);
    assert.equal(withBasePath(href, basePath), href);
    assert.equal(withBasePath(`${href}?v=1#icon`, basePath), `${href}?v=1#icon`);
    assert.equal(withBasePath("/api/auth/login", basePath), `${basePath}/api/auth/login`);
  }
  assert.equal(withBasePath("/pms-other/favicon.ico", "/pms"), "/pms/pms-other/favicon.ico");
  assert.equal(withBasePath("/pms?check=1", "/pms"), "/pms?check=1");
});

test("部署前缀只接受明确安全路径，非法值以中文拒绝", () => {
  assert.equal(getBasePath(""), ""); assert.equal(getBasePath("/pms"), "/pms");
  for (const value of ["pms", "/pms/", "//pms", "/pms/../admin", "/pms?query", "https://external.invalid", "/pms\\admin"]) {
    assert.throws(() => getBasePath(value), /部署前缀格式不正确/);
  }
});
