#!/bin/bash
set -e
SCRIPT_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

if [ ! -f "${SCRIPT_HOME}/.env" ]; then
    echo "ERROR: .env file not found."
    echo "Copy .env.example and configure: cp .env.example .env"
    exit 1
fi

pushd "${SCRIPT_HOME}" > /dev/null
    docker compose up -d --build --remove-orphans
popd > /dev/null

echo ""
echo "Sawbuck is starting..."
echo "  App:  http://localhost:3001"
