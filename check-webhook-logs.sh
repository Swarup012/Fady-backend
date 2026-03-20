#!/bin/bash
echo "Showing last webhook logs..."
docker-compose logs --tail=200 backend 2>&1 | grep -A20 "subscription.created"
