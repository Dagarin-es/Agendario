/** Ajustes de la sincronización con Todoist (cada usuario la suya). */
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { todoistSettingsSchema } from "@agendario/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth, type AppEnv } from "../lib/auth.js";
import { forgetTodoist, listProjects, loadTodoist, pullUser, pushExisting, saveTodoist, statusOf, TodoistError, type TodoistConfig } from "../lib/todoist.js";

const fail = (e: unknown): never => {
  throw new HTTPException(400, { message: e instanceof TodoistError ? e.message : "No se ha podido hablar con Todoist" });
};

export const todoistRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get("/", async (ctx) => ctx.json(statusOf(await loadTodoist(ctx.get("user").id))))
  /** Conectar (con clave nueva) o cambiar opciones. Con clave, se comprueba antes de guardarla. */
  .put("/", zValidator("json", todoistSettingsSchema), async (ctx) => {
    const user = ctx.get("user");
    const b = ctx.req.valid("json");
    const prev = await loadTodoist(user.id);
    const token = b.token?.trim() || prev?.token;
    if (!token) throw new HTTPException(400, { message: "Falta la clave de Todoist" });
    const projects = await listProjects(token).catch(fail);
    const projectId = b.projectId !== undefined ? b.projectId : prev?.projectId ?? null;
    const project = projectId ? projects.find((p) => p.id === projectId) : null;
    if (projectId && !project) throw new HTTPException(400, { message: "Ese proyecto ya no existe en Todoist" });
    const cfg: TodoistConfig = {
      token,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      label: (b.label ?? prev?.label ?? "").trim().replace(/\s+/g, "_"),
      phoneAlerts: b.phoneAlerts ?? prev?.phoneAlerts ?? true,
      publicUrl: (b.publicUrl ?? prev?.publicUrl ?? "").trim().replace(/\/+$/, ""),
      lastSyncAt: prev?.lastSyncAt ?? null,
      lastError: null,
    };
    if (cfg.publicUrl && !/^https?:\/\/[^\s/]+/.test(cfg.publicUrl)) throw new HTTPException(400, { message: "La dirección de Agendario debe empezar por https://" });
    await saveTodoist(user.id, cfg);
    return ctx.json(statusOf(cfg));
  })
  .get("/projects", async (ctx) => {
    const cfg = await loadTodoist(ctx.get("user").id);
    if (!cfg?.token) throw new HTTPException(400, { message: "Todoist no está conectado" });
    return ctx.json(await listProjects(cfg.token).catch(fail));
  })
  /** Manda a Todoist los recordatorios pendientes que aún no tienen tarea. */
  .post("/push-existing", async (ctx) => ctx.json({ sent: await pushExisting(ctx.get("user").id) }))
  /** Sincronizar ahora (Todoist → Agendario). */
  .post("/sync", async (ctx) => {
    const user = ctx.get("user");
    const changed = await pullUser(user.id);
    return ctx.json({ changed, status: statusOf(await loadTodoist(user.id)) });
  })
  .delete("/", async (ctx) => {
    const user = ctx.get("user");
    await forgetTodoist(user.id);
    // Las tareas se quedan en Todoist; aquí se quita el enlace
    await db.update(schema.reminders).set({ todoistId: null, todoistUnlinked: false }).where(eq(schema.reminders.userId, user.id));
    return ctx.body(null, 204);
  });
