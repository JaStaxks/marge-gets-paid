import { AppError } from "@/lib/types";

export function jsonError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[marge]", error instanceof Error ? error.message : "unknown error");
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}
