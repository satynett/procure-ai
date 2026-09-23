# PostgreSQL integration

The ProcureShield server now uses PostgreSQL as the persistent source for bidders, bids, tenders and audit logs. The React API contract remains unchanged.

## Local setup

1. Install PostgreSQL and create a database named `procureshield`.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to your local PostgreSQL connection.
4. Run the server.

On first startup the application creates its PostgreSQL tables and seeds the clean fictional Indian procurement dataset when those tables are empty.

## Deployment

Set `DATABASE_URL` to the managed PostgreSQL connection string supplied by your hosting provider. The application code does not need to change. If the provider requires TLS, use a URL containing `sslmode=require` or set `DATABASE_SSL=true`.

## Data model

The first migration uses four PostgreSQL tables with JSONB payloads:

- `procure_bidders`
- `procure_tenders`
- `procure_bids`
- `procure_audit_logs`

This preserves the existing API shapes while moving persistence out of JSON files. PostgreSQL JSONB is indexable and supports efficient JSON querying; the design can be normalized into separate relational columns later without changing the frontend.

All identities, registrations, contacts, document references and procurement values in the seed dataset are fictional demo data.
