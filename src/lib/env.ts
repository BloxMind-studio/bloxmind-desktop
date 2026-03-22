const params = new URLSearchParams(window.location.search);

export function getOpenCodePort(): number | undefined {
  const port = params.get("port");
  return port ? Number(port) : undefined;
}

export function getWorkspaceDir(): string {
  return params.get("workspace") ?? "";
}
