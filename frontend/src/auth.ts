export function initTokenFromUrl(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return;

  sessionStorage.setItem("authToken", token);
  url.searchParams.delete("token");
  window.history.replaceState({}, "", url.toString());
}

export function getAuthToken(): string | null {
  return sessionStorage.getItem("authToken");
}

