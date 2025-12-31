# Fady Backend - Docker Setup

This guide explains how to run the Fady backend using Docker.

## Prerequisites

- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose installed (comes with Docker Desktop)
- `.env` file configured (copy from `.env.example`)

## Quick Start

### 1. Setup Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and add your Supabase credentials
nano .env
```

**Important**: Make sure to set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- For Docker, use: `REDIS_HOST=redis` (not localhost)

### 2. Build and Run

```bash
# Build and start all services (backend + redis)
docker-compose up -d

# View logs
docker-compose logs -f backend

# Check status
docker-compose ps
```

### 3. Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clears Redis cache)
docker-compose down -v
```

## Services

### Backend API
- **Port**: 3000
- **Container**: fady-backend
- **Health**: Check at `http://localhost:3000/health`

### Redis Cache
- **Port**: 6379
- **Container**: fady-redis
- **Data**: Persisted in `redis-data` volume

## Development vs Production

### Development Mode (with hot reload)
```bash
# Use nodemon for auto-restart on file changes
docker-compose -f docker-compose.dev.yml up
```

### Production Mode
```bash
# Uses optimized build
docker-compose up -d
```

## Useful Commands

```bash
# Rebuild after code changes
docker-compose up -d --build

# View backend logs
docker-compose logs -f backend

# View Redis logs
docker-compose logs -f redis

# Execute commands in backend container
docker-compose exec backend sh

# Clear Redis cache
docker-compose exec redis redis-cli FLUSHALL

# Restart specific service
docker-compose restart backend

# Check resource usage
docker stats
```

## Troubleshooting

### Port Already in Use
```bash
# Check what's using port 3000
lsof -i :3000

# Kill the process or change PORT in .env
```

### Redis Connection Failed
```bash
# Ensure Redis is running
docker-compose ps redis

# Check Redis logs
docker-compose logs redis
```

### Backend Crashes on Startup
```bash
# Check backend logs
docker-compose logs backend

# Verify .env file exists and has correct values
cat .env
```

### Clear Everything and Start Fresh
```bash
# Stop and remove everything
docker-compose down -v

# Rebuild from scratch
docker-compose up -d --build
```

## Environment Variables for Docker

When running in Docker, use these Redis settings in `.env`:

```bash
REDIS_ENV=development
REDIS_HOST=redis        # ← Use service name, not localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

## Network Configuration

All services run on the `fady-network` bridge network, allowing them to communicate using service names:
- Backend can access Redis at `redis:6379`
- Services are isolated from other Docker containers

## Volume Mounts

- `redis-data`: Redis data persistence
- `./logs`: Backend application logs (mounted from host)

## Production Deployment

For production deployment, consider:

1. **Use environment-specific .env file**
2. **Enable HTTPS/SSL**
3. **Set up proper logging**
4. **Configure health checks**
5. **Use Docker secrets for sensitive data**
6. **Set resource limits**

Example production override:
```yaml
# docker-compose.prod.yml
services:
  backend:
    environment:
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
```

Run with: `docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
