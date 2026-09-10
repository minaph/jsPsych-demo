export interface HelloAnswer {
  id: string;
  response: "hello";
  rtMs: number;
}

export interface SavedAnswer extends HelloAnswer {
  savedAt: string;
}

export interface Health {
  ok: true;
  database: "connected";
}

export function isHelloAnswer(value: unknown): value is HelloAnswer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === 3 &&
    typeof data.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id) &&
    data.response === "hello" &&
    typeof data.rtMs === "number" &&
    Number.isInteger(data.rtMs) &&
    data.rtMs >= 0 &&
    data.rtMs <= 86_400_000
  );
}
