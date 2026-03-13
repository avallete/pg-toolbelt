import { Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { handleCatalogExport } from "./catalog-export.handler.ts";

const target = Flag.string("target").pipe(
  Flag.withAlias("t"),
  Flag.withDescription(
    "Target database connection URL to extract the catalog from",
  ),
);

const output = Flag.string("output").pipe(
  Flag.withAlias("o"),
  Flag.withDescription("Output file path for the catalog snapshot JSON"),
);

const role = Flag.string("role").pipe(
  Flag.withDescription("Role to use when extracting the catalog (SET ROLE)"),
  Flag.optional,
);

export const catalogExportCommand = Command.make(
  "catalog-export",
  { target, output, role },
  (args) =>
    handleCatalogExport({
      target: args.target,
      output: args.output,
      role: Option.getOrUndefined(args.role),
    }),
);
