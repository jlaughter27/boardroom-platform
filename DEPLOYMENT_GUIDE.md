# BoardRoom AI Platform Deployment Guide

## Overview

BoardRoom AI is a multi-service platform consisting of:
1. **OmniMind API** - Memory & data layer (Express + Prisma)
2. **BoardRoom AI** - UI + persona orchestration (React + Express)
3. **Shared** - Types, Zod schemas, constants

## Prerequisites

### Environment Requirements
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL 16+ with pgvector extension
- Redis (optional, for caching)

### Required API Keys
1. **Anthropic API Key** - For Claude LLM interactions
2. **OpenAI API Key** - For embeddings (optional, Anthropic can be used)
3. **Stripe API Keys** - For payment processing
4. **Email Service** - For user notifications

## Deployment Options

### Option 1: Railway.app (Recommended)

The platform already has Railway configuration files:

```bash
# Deploy OmniMind API
railway login
railway link
railway up --service=omnimind-api

# Deploy BoardRoom AI
railway up --service=boardroom-ai

# Add PostgreSQL plugin
railway add --plugin=postgresql

# Add Redis plugin (optional)
railway add --plugin=redis

# Set environment variables
railway variables set DATABASE_URL=postgresql://...
railway variables set ANTHROPIC_API_KEY=your-key
railway variables set OPENAI_API_KEY=your-key
railway variables set JWT_SECRET=secure-random-string
railway variables set OMNIMIND_API_KEY=secure-api-key
```

### Option 2: Docker Compose (Local/Development)

```bash
# 1. Build and start all services
npm run build
docker-compose up --build

# 2. Setup environment
cp .env.example .env
# Edit .env with your API keys

# 3. Run database migrations
cd packages/omnimind-api
npx prisma migrate deploy

# 4. Start services
npm run dev
```

### Option 3: Manual Deployment

```bash
# 1. Build all packages
npm run build

# 2. Install production dependencies
pnpm install --prod

# 3. Setup environment
cp .env.example .env.production
# Configure all required environment variables

# 4. Start services individually

# OmniMind API
cd packages/omnimind-api
node dist/index.js

# BoardRoom AI
cd packages/boardroom-ai
cd server && node dist/index.js  # API server
cd ../client && serve -s dist    # Frontend
```

## Environment Configuration

### Required Variables

Create a `.env` file with:

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...

# Security
JWT_SECRET=secure-random-string-32-chars
OMNIMIND_API_KEY=secure-api-key-for-service-auth
ENCRYPTION_KEY=256-bit-hex-key-for-sensitive-data

# Service URLs
OMNIMIND_API_URL=http://localhost:3333  # Or your OmniMind URL
APP_URL=http://localhost:3001           # Your BoardRoom URL

# Ports
OMNIMIND_PORT=3333
BOARDROOM_PORT=3001

# CORS
CORS_ORIGINS=http://localhost:3001,http://localhost:5173

# Stripe (Payment)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Feature Flags
MOCK_LLM=false
NODE_ENV=production
```

## Database Setup

### PostgreSQL with pgvector

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Or use Docker image with pgvector pre-installed
-- docker run -d --name postgres -p 5432:5432 pgvector/pgvector:pg16
```

### Run Migrations

```bash
cd packages/omnimind-api

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed database (optional)
npx tsx prisma/seed.ts
```

## Health Checks

After deployment, verify services are healthy:

```bash
# OmniMind API
curl http://your-omnimind-url/health
# Expected: {"status":"ok","service":"omnimind-api",...}

# BoardRoom AI
curl http://your-boardroom-url/health
# Expected: {"status":"ok","service":"boardroom-ai",...}

# Run E2E tests
./scripts/test-e2e.sh
```

## Monitoring & Logging

### Key Health Metrics
- API response time (< 500ms p95)
- Error rate (< 1%)
- Database connection pool utilization (< 80%)
- LLM API latency (< 2s)

### Logging Configuration

```javascript
// In your environment variables
LOG_LEVEL=info  # debug, info, warn, error
LOG_FORMAT=json  # json, pretty
```

## Scaling Considerations

### Horizontal Scaling
- **Stateless Services**: Both APIs are stateless and can be scaled horizontally
- **Database Connection Pool**: Adjust pool size based on concurrent connections
- **Redis**: Use for session storage and caching when scaling

### Recommended Infrastructure

```yaml
# For production traffic:
- OmniMind API: 2-4 instances
- BoardRoom AI (API): 2-4 instances
- BoardRoom AI (Frontend): CDN-hosted static assets
- PostgreSQL: 4+ GB RAM, connection pool 50-100
- Redis: 1-2 GB RAM for caching
```

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Check DATABASE_URL format
   - Verify network connectivity
   - Ensure PostgreSQL is running

2. **LLM API Failures**
   - Verify API keys are valid
   - Check Anthropic/OpenAI service status
   - Review rate limits and quotas

3. **CORS Errors**
   - Ensure CORS_ORIGINS includes all client URLs
   - Check frontend is calling correct API URL

4. **Memory Issues**
   - Increase Node.js memory limit: NODE_OPTIONS="--max-old-space-size=4096"
   - Monitor memory usage in production

### Log Analysis

```bash
# Check for errors
docker-compose logs api | grep -i error

# Monitor health
watch -n 5 'curl -s http://localhost:3333/health'

# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM memory_entries;"
```

## Security Best Practices

1. **Environment Variables**
   - Never commit .env files
   - Use different keys for development/production
   - Rotate keys regularly

2. **Database Security**
   - Enable SSL for database connections
   - Use strong passwords
   - Implement Row Level Security (RLS)

3. **API Security**
   - Rate limiting on all endpoints
   - Input validation with Zod schemas
   - JWT token expiration (7 days)

4. **Monitoring**
   - Audit logs for sensitive operations
   - Alert on security events
   - Regular security scans

## Backup & Recovery

### Database Backups

```bash
# Automated backup script
./scripts/backup.sh

# Restore from backup
pg_restore -d $DATABASE_URL backup-file.sql
```

### Disaster Recovery
1. **Daily Backups**: Automated PostgreSQL backups
2. **Point-in-Time Recovery**: Enable WAL archiving
3. **Test Restores**: Monthly recovery testing

## Performance Optimization

### Database Indexes
- Ensure pgvector indexes exist for similarity search
- Add indexes on frequently queried columns
- Regular VACUUM and ANALYZE

### Caching Strategy
- Redis for session storage
- Memory cache for LLM responses (with TTL)
- CDN for static assets

### LLM Optimization
- Prompt caching for common queries
- Response streaming for better UX
- Budget enforcement per user/session

## Support & Resources

- **Documentation**: See `docs/` directory
- **Runbooks**: Operational procedures in `docs/runbooks/`
- **Test Suite**: Comprehensive tests in `tests/`
- **Health Checks**: `scripts/health-check.sh`

## Deployment Checklist

✅ Build all packages (`npm run build`)
✅ Configure environment variables
✅ Setup PostgreSQL with pgvector
✅ Run database migrations
✅ Test services locally
✅ Configure production URLs
✅ Setup monitoring and alerts
✅ Enable backups
✅ Security review
✅ Load testing
✅ Go live!
