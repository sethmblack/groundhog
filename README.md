# Groundhog

New Relic Dashboard Backup & Restore SaaS Platform

## Overview

Groundhog enables organizations to automatically backup and restore their New Relic dashboards. The name references "Groundhog Day" - capturing moments in time that can be revisited and restored.

## Features

- Automated daily backups of all dashboard configurations
- Version history with the ability to restore any previous state
- Multi-account, multi-organization support
- Audit trails for compliance
- Stripe-based billing with multiple tiers

## Tech Stack

- **Backend**: TypeScript, Node.js 20.x, Fastify
- **Infrastructure**: AWS CDK, Lambda, DynamoDB, S3, SQS
- **Frontend**: Next.js 14, React 18, Tailwind CSS
- **Auth**: AWS Cognito
- **Payments**: Stripe

## Getting Started

```bash
# Install dependencies
pnpm install

# Start local development
docker-compose up -d
pnpm dev

# Run tests
pnpm test
```

## License

Proprietary
