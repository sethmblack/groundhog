import { logger } from '@/lib/logger';
import { ExternalServiceError } from '@/lib/errors';
import { Dashboard } from '@/types';

const NERDGRAPH_URL = 'https://api.newrelic.com/graphql';

export interface NewRelicAccount {
  id: string;
  name: string;
}

export interface NewRelicDashboard {
  guid: string;
  name: string;
  accountId: number;
  owner?: {
    email: string;
  };
  updatedAt?: string;
}

export interface NewRelicDashboardDetail {
  guid: string;
  name: string;
  description?: string;
  accountId: number;
  owner?: {
    email: string;
  };
  permissions: string;
  pages: Array<{
    guid: string;
    name: string;
    widgets: Array<{
      id: string;
      title: string;
      configuration: unknown;
      rawConfiguration: unknown;
    }>;
  }>;
  variables: unknown[];
  createdAt: string;
  updatedAt: string;
}

interface NerdGraphResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class NewRelicClient {
  private apiKey: string;
  private accountIds: string[];

  constructor(apiKey: string, accountIds: string[] = []) {
    this.apiKey = apiKey;
    this.accountIds = accountIds;
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    try {
      const response = await fetch(NERDGRAPH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'API-Key': this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new ExternalServiceError(
          'NewRelic',
          `API returned ${response.status}: ${response.statusText}`
        );
      }

      const result = (await response.json()) as NerdGraphResponse<T>;

      if (result.errors && result.errors.length > 0) {
        const errorMessage = result.errors.map((e) => e.message).join(', ');
        logger.warn({ errors: result.errors }, 'NerdGraph returned errors');
        throw new ExternalServiceError('NewRelic', errorMessage);
      }

      if (!result.data) {
        throw new ExternalServiceError('NewRelic', 'No data returned from NerdGraph');
      }

      return result.data;
    } catch (error) {
      if (error instanceof ExternalServiceError) {
        throw error;
      }
      logger.error({ error }, 'NerdGraph query failed');
      throw new ExternalServiceError('NewRelic', 'Failed to communicate with NewRelic API');
    }
  }

  async validateApiKey(): Promise<{ valid: boolean; accounts: NewRelicAccount[] }> {
    const query = `
      {
        actor {
          accounts {
            id
            name
          }
        }
      }
    `;

    try {
      const data = await this.query<{
        actor: {
          accounts: Array<{ id: number; name: string }>;
        };
      }>(query);

      const accounts = data.actor.accounts.map((a) => ({
        id: String(a.id),
        name: a.name,
      }));

      return { valid: true, accounts };
    } catch (error) {
      logger.warn({ error }, 'API key validation failed');
      return { valid: false, accounts: [] };
    }
  }

  async listDashboards(accountId: string): Promise<Dashboard[]> {
    const query = `
      query ($accountId: Int!, $cursor: String) {
        actor {
          entitySearch(
            query: "type = 'DASHBOARD' AND accountId = $accountId"
            options: { limit: 200 }
          ) {
            results(cursor: $cursor) {
              entities {
                ... on DashboardEntityOutline {
                  guid
                  name
                  accountId
                  owner {
                    email
                  }
                  reporting
                }
              }
              nextCursor
            }
          }
        }
      }
    `;

    interface DashboardQueryResult {
      actor: {
        entitySearch: {
          results: {
            entities: NewRelicDashboard[];
            nextCursor: string | null;
          };
        };
      };
    }

    const allDashboards: Dashboard[] = [];
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const data: DashboardQueryResult = await this.query<DashboardQueryResult>(
        query,
        { accountId: parseInt(accountId, 10), cursor }
      );

      const searchResults = data.actor.entitySearch.results;
      const entities = searchResults.entities;

      for (const entity of entities) {
        allDashboards.push({
          guid: entity.guid,
          name: entity.name,
          accountId: String(entity.accountId),
          accountName: '', // Will be filled in later
          ownerEmail: entity.owner?.email,
          updatedAt: entity.updatedAt,
        });
      }

      cursor = searchResults.nextCursor;
      hasMore = cursor !== null;
    }

    return allDashboards;
  }

  async getDashboard(guid: string): Promise<NewRelicDashboardDetail | null> {
    const query = `
      query ($guid: EntityGuid!) {
        actor {
          entity(guid: $guid) {
            ... on DashboardEntity {
              guid
              name
              description
              accountId
              owner {
                email
              }
              permissions
              pages {
                guid
                name
                widgets {
                  id
                  title
                  configuration
                  rawConfiguration
                }
              }
              variables {
                name
                type
                defaultValues
                items {
                  value
                  title
                }
                nrqlQuery {
                  accountIds
                  query
                }
                replacementStrategy
                isMultiSelection
              }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    try {
      const data = await this.query<{
        actor: {
          entity: NewRelicDashboardDetail | null;
        };
      }>(query, { guid });

      return data.actor.entity;
    } catch (error) {
      logger.error({ error, guid }, 'Failed to fetch dashboard');
      return null;
    }
  }

  async getDashboardJson(guid: string): Promise<string | null> {
    const dashboard = await this.getDashboard(guid);
    if (!dashboard) {
      return null;
    }
    return JSON.stringify(dashboard, null, 2);
  }

  async createDashboard(accountId: string, dashboardJson: string): Promise<string> {
    const mutation = `
      mutation ($accountId: Int!, $dashboard: DashboardInput!) {
        dashboardCreate(accountId: $accountId, dashboard: $dashboard) {
          entityResult {
            guid
            name
          }
          errors {
            description
            type
          }
        }
      }
    `;

    const dashboard = JSON.parse(dashboardJson);

    const data = await this.query<{
      dashboardCreate: {
        entityResult: { guid: string; name: string } | null;
        errors: Array<{ description: string; type: string }>;
      };
    }>(mutation, {
      accountId: parseInt(accountId, 10),
      dashboard,
    });

    if (data.dashboardCreate.errors.length > 0) {
      const errorMessage = data.dashboardCreate.errors
        .map((e) => e.description)
        .join(', ');
      throw new ExternalServiceError('NewRelic', `Dashboard creation failed: ${errorMessage}`);
    }

    if (!data.dashboardCreate.entityResult) {
      throw new ExternalServiceError('NewRelic', 'Dashboard creation returned no result');
    }

    return data.dashboardCreate.entityResult.guid;
  }

  async updateDashboard(guid: string, dashboardJson: string): Promise<void> {
    const mutation = `
      mutation ($guid: EntityGuid!, $dashboard: DashboardInput!) {
        dashboardUpdate(guid: $guid, dashboard: $dashboard) {
          entityResult {
            guid
          }
          errors {
            description
            type
          }
        }
      }
    `;

    const dashboard = JSON.parse(dashboardJson);

    const data = await this.query<{
      dashboardUpdate: {
        entityResult: { guid: string } | null;
        errors: Array<{ description: string; type: string }>;
      };
    }>(mutation, { guid, dashboard });

    if (data.dashboardUpdate.errors.length > 0) {
      const errorMessage = data.dashboardUpdate.errors
        .map((e) => e.description)
        .join(', ');
      throw new ExternalServiceError('NewRelic', `Dashboard update failed: ${errorMessage}`);
    }
  }
}
