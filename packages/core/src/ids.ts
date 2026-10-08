import { randomUUID } from "node:crypto";
import * as z from "zod";

export const idPrefixes = {
  project: "prj",
  workItem: "wrk",
  revision: "rev",
  unit: "unt",
  attempt: "att",
  worker: "wkr",
  machine: "mch",
  gate: "gat",
  verdict: "vrd",
} as const;

export type IdKind = keyof typeof idPrefixes;

const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function idSchema<Kind extends IdKind>(kind: Kind) {
  return z
    .string()
    .regex(new RegExp(`^${idPrefixes[kind]}_${uuidPattern}$`))
    .brand<Kind>();
}

export const ProjectIdSchema = idSchema("project");
export const WorkItemIdSchema = idSchema("workItem");
export const RevisionIdSchema = idSchema("revision");
export const UnitIdSchema = idSchema("unit");
export const AttemptIdSchema = idSchema("attempt");
export const WorkerIdSchema = idSchema("worker");
export const MachineIdSchema = idSchema("machine");
export const GateIdSchema = idSchema("gate");
export const VerdictIdSchema = idSchema("verdict");

export type ProjectId = z.output<typeof ProjectIdSchema>;
export type WorkItemId = z.output<typeof WorkItemIdSchema>;
export type RevisionId = z.output<typeof RevisionIdSchema>;
export type UnitId = z.output<typeof UnitIdSchema>;
export type AttemptId = z.output<typeof AttemptIdSchema>;
export type WorkerId = z.output<typeof WorkerIdSchema>;
export type MachineId = z.output<typeof MachineIdSchema>;
export type GateId = z.output<typeof GateIdSchema>;
export type VerdictId = z.output<typeof VerdictIdSchema>;

type IdByKind = {
  project: ProjectId;
  workItem: WorkItemId;
  revision: RevisionId;
  unit: UnitId;
  attempt: AttemptId;
  worker: WorkerId;
  machine: MachineId;
  gate: GateId;
  verdict: VerdictId;
};

export type OpaqueId<Kind extends IdKind> = IdByKind[Kind];
type AnyId = IdByKind[IdKind];

/** Creates and validates a stable identifier for the requested domain kind. */
export function createId(kind: "project"): ProjectId;
export function createId(kind: "workItem"): WorkItemId;
export function createId(kind: "revision"): RevisionId;
export function createId(kind: "unit"): UnitId;
export function createId(kind: "attempt"): AttemptId;
export function createId(kind: "worker"): WorkerId;
export function createId(kind: "machine"): MachineId;
export function createId(kind: "gate"): GateId;
export function createId(kind: "verdict"): VerdictId;
export function createId(kind: IdKind): AnyId {
  const value = `${idPrefixes[kind]}_${randomUUID()}`;

  switch (kind) {
    case "project":
      return ProjectIdSchema.parse(value);
    case "workItem":
      return WorkItemIdSchema.parse(value);
    case "revision":
      return RevisionIdSchema.parse(value);
    case "unit":
      return UnitIdSchema.parse(value);
    case "attempt":
      return AttemptIdSchema.parse(value);
    case "worker":
      return WorkerIdSchema.parse(value);
    case "machine":
      return MachineIdSchema.parse(value);
    case "gate":
      return GateIdSchema.parse(value);
    case "verdict":
      return VerdictIdSchema.parse(value);
  }
}
