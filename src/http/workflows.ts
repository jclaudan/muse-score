import type { FastifyInstance } from "fastify";
import { runWorkflow } from "../core/usecases.js";
import type { Deps } from "../core/usecases.js";
import type { WorkflowInput } from "../core/model.js";
import { toHttp } from "./errors.js";
import { readUpload } from "./multipart.js";

// Workflows CRUD + historique + exécution.
export function registerWorkflows(app: FastifyInstance, deps: Deps): void {
  app.get("/workflows", async () => deps.workflows.workflows());

  app.post("/workflows", async (req, reply) => {
    try {
      const wf = await deps.workflows.create(
        (await req.body) as WorkflowInput,
      );
      return reply.code(201).send(wf);
    } catch (e) {
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });

  app.put("/workflows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const wf = await deps.workflows.update(
        id,
        (await req.body) as WorkflowInput,
      );
      if (!wf) return reply.code(404).send({ error: "Workflow introuvable" });
      return wf;
    } catch (e) {
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });

  app.delete("/workflows/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await deps.workflows.remove(id))) {
      return reply.code(404).send({ error: "Workflow introuvable" });
    }
    return { deleted: true };
  });

  app.get("/runs", async () => deps.runs.runs());

  app.post("/workflows/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { files, fields } = await readUpload(req);
    try {
      const dryRun =
        fields.dryRun !== undefined
          ? fields.dryRun === "true" || fields.dryRun === "1"
          : undefined;
      return reply.send(
        await runWorkflow(deps, id, files, dryRun === undefined ? {} : { dryRun }),
      );
    } catch (e) {
      req.log.error(e);
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });
}
