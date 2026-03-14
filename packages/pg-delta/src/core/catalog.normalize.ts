import { Catalog } from "./catalog.ts";
import { Server } from "./objects/foreign-data-wrapper/server/server.model.ts";
import { UserMapping } from "./objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { Subscription } from "./objects/subscription/subscription.model.ts";

const SUBSCRIPTION_CONNINFO_PLACEHOLDER =
  "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__";

export function normalizeCatalog(catalog: Catalog): Catalog {
  const servers = mapRecord(catalog.servers, (server) => {
    const maskedOptions = maskOptions(server.options);
    return new Server({
      name: server.name,
      owner: server.owner,
      foreign_data_wrapper: server.foreign_data_wrapper,
      type: server.type,
      version: server.version,
      options: maskedOptions,
      comment: server.comment,
      privileges: server.privileges,
    });
  });

  const userMappings = mapRecord(catalog.userMappings, (mapping) => {
    const maskedOptions = maskOptions(mapping.options);
    return new UserMapping({
      user: mapping.user,
      server: mapping.server,
      options: maskedOptions,
    });
  });

  const subscriptions = mapRecord(catalog.subscriptions, (subscription) => {
    return new Subscription({
      name: subscription.name,
      raw_name: subscription.raw_name,
      owner: subscription.owner,
      comment: subscription.comment,
      enabled: subscription.enabled,
      binary: subscription.binary,
      streaming: subscription.streaming,
      two_phase: subscription.two_phase,
      disable_on_error: subscription.disable_on_error,
      password_required: subscription.password_required,
      run_as_owner: subscription.run_as_owner,
      failover: subscription.failover,
      conninfo: SUBSCRIPTION_CONNINFO_PLACEHOLDER,
      slot_name: subscription.slot_name,
      slot_is_none: subscription.slot_is_none,
      replication_slot_created: subscription.replication_slot_created,
      synchronous_commit: subscription.synchronous_commit,
      publications: subscription.publications,
      origin: subscription.origin,
    });
  });

  return new Catalog({
    aggregates: catalog.aggregates,
    collations: catalog.collations,
    compositeTypes: catalog.compositeTypes,
    domains: catalog.domains,
    enums: catalog.enums,
    extensions: catalog.extensions,
    procedures: catalog.procedures,
    indexes: catalog.indexes,
    materializedViews: catalog.materializedViews,
    subscriptions,
    publications: catalog.publications,
    rlsPolicies: catalog.rlsPolicies,
    roles: catalog.roles,
    schemas: catalog.schemas,
    sequences: catalog.sequences,
    tables: catalog.tables,
    triggers: catalog.triggers,
    eventTriggers: catalog.eventTriggers,
    rules: catalog.rules,
    ranges: catalog.ranges,
    views: catalog.views,
    foreignDataWrappers: catalog.foreignDataWrappers,
    servers,
    userMappings,
    foreignTables: catalog.foreignTables,
    depends: catalog.depends,
    indexableObjects: catalog.indexableObjects,
    version: catalog.version,
    currentUser: catalog.currentUser,
  });
}

function maskOptions(options: string[] | null): string[] | null {
  if (!options || options.length === 0) return options;
  const masked: string[] = [];
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1];
    if (key === undefined || value === undefined) continue;
    masked.push(key, `__OPTION_${key.toUpperCase()}__`);
  }
  return masked.length > 0 ? masked : null;
}

function mapRecord<TValue, TResult>(
  record: Record<string, TValue>,
  mapper: (value: TValue) => TResult,
): Record<string, TResult> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, mapper(value)]),
  );
}
