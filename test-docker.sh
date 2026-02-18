#!/bin/bash

echo "🦞 Testing AgentGuilds Docker Setup"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi
echo "✅ Docker installed"

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose first."
    exit 1
fi
echo "✅ Docker Compose installed"

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env not found. Creating from template..."
    cp .env.example .env
    echo "📝 Please edit .env with your values before running docker-compose up"
fi
echo "✅ .env file exists"

# Test Docker build
echo ""
echo "Testing Docker build..."
echo "(This will take 5-10 minutes on first run)"
echo ""

docker-compose -f infra/docker-compose.yml build

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Docker build successful!"
    echo ""
    echo "Next steps:"
    echo "1. Edit .env with your values (contract address, private key, etc.)"
    echo "2. Run: docker-compose -f infra/docker-compose.yml up -d"
    echo "3. Check logs: docker logs -f agentguilds"
else
    echo ""
    echo "❌ Docker build failed. Check errors above."
    exit 1
fi
