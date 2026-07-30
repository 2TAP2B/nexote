// API client for the Nexote Go backend. During development the requests are
// proxied to http://localhost:8080 via next.config.mjs rewrites, so the app
// uses same-origin relative URLs.

export type NoteMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Note = NoteMeta & {
  body: string;
};

export type NoteInput = {
  title?: string;
  body?: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore json parse errors
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  list: () => request<NoteMeta[]>("/api/notes"),
  get: (id: string) => request<Note>(`/api/notes/${id}`),
  create: (input: NoteInput) =>
    request<Note>("/api/notes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: NoteInput) =>
    request<Note>(`/api/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/api/notes/${id}`, { method: "DELETE" }),
};