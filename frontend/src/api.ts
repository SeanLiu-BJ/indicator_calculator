import { getAuthToken } from "./auth";

export class ApiError extends Error {
  status: number;
  bodyText: string;

  constructor(status: number, bodyText: string) {
    super(bodyText || `Request failed: ${status}`);
    this.status = status;
    this.bodyText = bodyText;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }
  return (await res.json()) as T;
}

export const api = {
  get: request,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  del: <T>(path: string) =>
    request<T>(path, {
      method: "DELETE",
    }),
};

export async function uploadDataset(file: File, name?: string, yearOverride?: number): Promise<{ datasetId: string }> {
  const token = getAuthToken();
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  if (typeof yearOverride === "number") form.append("yearOverride", String(yearOverride));

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`/api/datasets/import`, { method: "POST", body: form, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }
  return (await res.json()) as { datasetId: string };
}

