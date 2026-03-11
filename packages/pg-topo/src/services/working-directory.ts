import { Layer, ServiceMap } from "effect";

export interface WorkingDirectoryApi {
  readonly cwd: string;
}

export class WorkingDirectory extends ServiceMap.Service<
  WorkingDirectory,
  WorkingDirectoryApi
>()("@pg-topo/WorkingDirectory") {}

export const makeWorkingDirectoryLayer = (cwd: string) =>
  Layer.succeed(WorkingDirectory, { cwd });
