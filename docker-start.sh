#!/bin/bash

# Fady Backend - Docker Start Script

echo "🚀 Starting Fady Backend with Docker..."
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "📝 Please create .env file from .env.example:"
    echo "   cp .env.example .env"
    echo "   nano .env"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running!"
    echo "Please start Docker Desktop and try again."
    exit 1
fi

# Choose mode
echo "Select mode:"
echo "1) Production (optimized build)"
echo "2) Development (hot reload)"
read -p "Enter choice [1-2]: " choice

case $choice in
    1)
        echo "🏭 Starting in PRODUCTION mode..."
        docker-compose up -d --build
        ;;
    2)
        echo "🛠️  Starting in DEVELOPMENT mode..."
        docker-compose -f docker-compose.dev.yml up -d --build
        ;;
    *)
        echo "❌ Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "✅ Services started!"
echo ""
echo "📋 Useful commands:"
echo "   View logs:        docker-compose logs -f backend"
echo "   Stop services:    docker-compose down"
echo "   Clear cache:      docker-compose exec redis redis-cli FLUSHALL"
echo "   Backend health:   curl http://localhost:3000/health"
echo ""
