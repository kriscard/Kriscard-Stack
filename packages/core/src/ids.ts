import { randomUUID } from "node:crypto";
import { Type, type TString } from "@sinclair/typebox";

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
export type OpaqueId<Kind extends IdKind> = string & {
  readonly __idKind: Kind;
};

type TId<Kind extends IdKind> = TString & {
  static: OpaqueId<Kind>;
};

const uuidPattern =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function createId<Kind extends IdKind>(kind: Kind): OpaqueId<Kind> {
  return `${idPrefixes[kind]}_${randomUUID()}` as OpaqueId<Kind>;
}

export function idSchema<Kind extends IdKind>(kind: Kind): TId<Kind> {
  return Type.String({
    pattern: `^${idPrefixes[kind]}_${uuidPattern}$`,
  }) as TId<Kind>;
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

export type ProjectId = OpaqueId<"project">;
export type WorkItemId = OpaqueId<"workItem">;
export type RevisionId = OpaqueId<"revision">;
export type UnitId = OpaqueId<"unit">;
export type AttemptId = OpaqueId<"attempt">;
export type WorkerId = OpaqueId<"worker">;
export type MachineId = OpaqueId<"machine">;
export type GateId = OpaqueId<"gate">;
export type VerdictId = OpaqueId<"verdict">;
