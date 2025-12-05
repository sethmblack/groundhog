# Groundhog

New Relic Dashboard Backup & Restore SaaS Platform

## Overview

Groundhog enables organizations to automatically backup and restore their New Relic dashboards. The name references "Groundhog Day" - capturing moments in time that can be revisited and restored.

## Features

- **Automated Backups**: Daily scheduled backups of all dashboard configurations
- **Version History**: Full snapshot history with point-in-time restore capability
- **Multi-Account Support**: Connect multiple New Relic accounts per organization
- **Multi-Tenancy**: Complete organization isolation with role-based access
- **Audit Logging**: Comprehensive audit trails for compliance
- **Usage Reports**: Detailed reporting on backup activity and storage usage
- **Stripe Billing**: Tiered subscription plans (Free, Pro, Enterprise)
- **Notifications**: Email alerts for backup status and failures

## Tech Stack

- **Backend**: TypeScript, Node.js 20.x, Fastify
- **Testing**: Vitest (119 tests)
- **Infrastructure**: AWS CDK (TypeScript)
- **Database**: DynamoDB (single-table design)
- **Storage**: S3 (versioned buckets)
- **Compute**: Lambda, SQS
- **Auth**: AWS Cognito
- **Payments**: Stripe
- **API**: New Relic NerdGraph GraphQL

## Project Structure

```
groundhog/
├── src/
│   ├── app.ts                    # Fastify app configuration
│   ├── types/                    # TypeScript types and Zod schemas
│   ├── lib/                      # Core utilities
│   │   ├── dynamodb.ts           # DynamoDB client
│   │   ├── s3.ts                 # S3 client
│   │   ├── jwt.ts                # JWT verification
│   │   ├── logger.ts             # Pino logger
│   │   ├── errors.ts             # Custom error classes
│   │   ├── secrets.ts            # Secrets Manager
│   │   └── security.ts           # Security utilities
│   ├── repositories/             # Data access layer
│   │   ├── user-repository.ts
│   │   ├── organization-repository.ts
│   │   ├── apikey-repository.ts
│   │   ├── backup-repository.ts
│   │   └── audit-repository.ts
│   ├── services/                 # Business logic
│   │   ├── auth-service.ts       # Cognito auth
│   │   ├── organization-service.ts
│   │   ├── apikey-service.ts
│   │   ├── backup-service.ts
│   │   ├── restore-service.ts
│   │   ├── billing-service.ts    # Stripe integration
│   │   ├── notification-service.ts # SES emails
│   │   └── reporting-service.ts
│   ├── handlers/                 # HTTP handlers
│   │   ├── lambda.ts             # Lambda entry point
│   │   ├── api/                  # API route handlers
│   │   └── queue/                # SQS processors
│   ├── middleware/               # Auth middleware
│   └── clients/                  # External API clients
│       └── newrelic.ts           # NerdGraph client
├── infrastructure/               # AWS CDK
│   └── lib/stacks/
│       ├── database-stack.ts
│       ├── storage-stack.ts
│       ├── auth-stack.ts
│       ├── api-stack.ts
│       └── queue-stack.ts
└── tests/                        # Vitest tests
    └── unit/
```

## API Endpoints

### Authentication
- `POST /auth/signup` - User registration
- `POST /auth/signin` - User login
- `POST /auth/refresh` - Refresh tokens
- `POST /auth/forgot-password` - Password reset request
- `POST /auth/confirm-forgot-password` - Complete password reset

### Organizations
- `GET /organizations` - List user's organizations
- `POST /organizations` - Create organization
- `GET /organizations/:orgId` - Get organization details
- `PUT /organizations/:orgId` - Update organization
- `DELETE /organizations/:orgId` - Delete organization
- `POST /organizations/:orgId/members` - Add member
- `DELETE /organizations/:orgId/members/:userId` - Remove member

### API Keys (New Relic)
- `GET /organizations/:orgId/apikeys` - List API keys
- `POST /organizations/:orgId/apikeys` - Create API key
- `GET /organizations/:orgId/apikeys/:keyId` - Get API key
- `PUT /organizations/:orgId/apikeys/:keyId` - Update API key
- `DELETE /organizations/:orgId/apikeys/:keyId` - Delete API key

### Dashboards & Backups
- `GET /organizations/:orgId/dashboards` - List dashboards
- `POST /organizations/:orgId/dashboards/:guid/backup` - Create backup
- `GET /organizations/:orgId/backups` - List backups
- `GET /organizations/:orgId/backups/:snapshotId` - Get backup

### Restore
- `POST /organizations/:orgId/restore` - Restore dashboard
- `POST /organizations/:orgId/restore/preview` - Preview restore

### Billing
- `GET /organizations/:orgId/billing` - Get subscription info
- `POST /organizations/:orgId/billing/checkout` - Create checkout session
- `POST /organizations/:orgId/billing/cancel` - Cancel subscription
- `POST /webhooks/stripe` - Stripe webhook handler

### Reports
- `GET /organizations/:orgId/reports/usage` - Usage report
- `GET /organizations/:orgId/reports/backups` - Backup summary
- `GET /organizations/:orgId/reports/audit` - Audit summary
- `GET /organizations/:orgId/reports/dashboards/:guid` - Dashboard history

### Health
- `GET /health` - Health check
- `GET /health/ready` - Readiness check

## Subscription Tiers

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| API Keys | 1 | 5 | 25 |
| Storage | 100 MB | 1 GB | 10 GB |
| Backups | Manual | Daily | Hourly |
| Support | Community | Email | Dedicated |

## Getting Started

### Prerequisites
- Node.js 20.x
- pnpm
- Docker (for local DynamoDB)
- AWS CLI configured

### Installation

```bash
# Clone repository
git clone https://github.com/sethmblack/groundhog.git
cd groundhog

# Install dependencies
pnpm install

# Install infrastructure dependencies
cd infrastructure && pnpm install && cd ..
```

### Local Development

```bash
# Start local DynamoDB
docker-compose up -d

# Run development server
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Infrastructure Deployment

```bash
cd infrastructure

# Synthesize CloudFormation templates
pnpm cdk synth

# Deploy all stacks
pnpm cdk deploy --all

# Deploy specific stack
pnpm cdk deploy GroundhogDatabaseStack
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Environment (development, test, production) |
| `AWS_REGION` | AWS region |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | Cognito Client ID |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRO_PRICE_ID` | Stripe Pro plan price ID |
| `STRIPE_ENTERPRISE_PRICE_ID` | Stripe Enterprise plan price ID |
| `SES_FROM_EMAIL` | Email sender address |
| `TABLE_NAME` | DynamoDB table name |
| `BACKUP_BUCKET_NAME` | S3 backup bucket name |

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test tests/unit/services/backup-service.test.ts
```

Current test coverage: 119 tests across 8 test files.

## Architecture

### DynamoDB Single-Table Design

All entities stored in a single table with composite keys:
- `PK`: Partition key (e.g., `ORG#123`, `USER#456`)
- `SK`: Sort key (e.g., `METADATA`, `BACKUP#2024-01-01`)
- `GSI1`: Global Secondary Index for access patterns

### Backup Flow

1. User triggers backup or scheduled EventBridge rule fires
2. API creates backup job and sends message to SQS
3. Lambda processor fetches dashboard from NerdGraph
4. Dashboard JSON stored in S3 with versioning
5. Backup record created in DynamoDB
6. Notification sent via SES on completion/failure

### Security

- JWT authentication via Cognito
- Role-based access (OWNER, ADMIN, USER)
- Organization-level isolation
- Input validation with Zod
- Rate limiting via Fastify plugin
- Security headers via Helmet
- Sensitive data masking in logs

## License

Proprietary
