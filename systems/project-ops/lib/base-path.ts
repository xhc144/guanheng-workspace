export function getBasePath(value = process.env.NEXT_PUBLIC_BASE_PATH ?? "") {
  if (value && !/^(?:\/[A-Za-z0-9_-]+)+$/.test(value)) {
    throw new Error("部署前缀格式不正确，请使用 /pms 这样的路径且不要以斜杠结尾");
  }
  return value;
}

export function withBasePath(path: string, configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "") {
  const basePath = getBasePath(configuredBasePath);
  const pathname = path.split(/[?#]/, 1)[0];
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) return path;
  return `${basePath}${path}`;
}

export function faviconMetadata(configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "") {
  return { icons: { icon: [{ url: withBasePath("/favicon.ico", configuredBasePath), sizes: "any" }] } };
}
